import os

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from sophon_interp.runtime import ALLOWED_MODELS, PromptTooLongError, extract_prompt_run
from sophon_interp.schemas import RunRequest

auth_scheme = HTTPBearer(auto_error=False)


def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme)):
    expected = os.environ.get("AUTH_TOKEN")
    if not expected:
        return
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")


def create_app() -> FastAPI:
    app = FastAPI(title="Sophon Interpretability API")
    allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/models")
    def models():
        return {"models": sorted(ALLOWED_MODELS)}

    @app.post("/runs", dependencies=[Depends(verify_token)])
    def run(request: RunRequest):
        try:
            return extract_prompt_run(request).model_dump(by_alias=True)
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
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "REQUEST_FAILED", "message": str(error)},
            ) from error

    return app
