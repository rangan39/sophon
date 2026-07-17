import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from sophon_interp.runtime import ALLOWED_MODELS, PromptTooLongError, extract_prompt_run, get_model
from sophon_interp.schemas import PromptRun, RunRequest

auth_scheme = HTTPBearer(auto_error=False)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    get_model("gpt2-small")
    yield


def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme)) -> None:
    expected = os.environ.get("AUTH_TOKEN")
    if not expected:
        return
    if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")


def create_app() -> FastAPI:
    app = FastAPI(title="Sophon Interpretability API", lifespan=lifespan)
    allowed_origins = [
        origin.strip()
        for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if origin.strip()
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/models")
    def models() -> dict[str, list[str]]:
        return {"models": sorted(ALLOWED_MODELS)}

    @app.post("/runs", dependencies=[Depends(verify_token)], response_model=PromptRun)
    def run(request: RunRequest) -> PromptRun:
        try:
            return extract_prompt_run(request)
        except PromptTooLongError as error:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "code": "PROMPT_TOO_LONG",
                    "message": "Prompt exceeds the model token cap.",
                    "tokenCount": error.token_count,
                    "maxTokens": error.max_tokens,
                },
            ) from error
    return app
