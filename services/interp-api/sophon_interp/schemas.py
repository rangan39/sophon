from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TokenKind = Literal["normal", "bos", "eos", "special"]
PredictionKind = Literal["normal", "special"]


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=280)
    model: Literal["gpt2-small"] = "gpt2-small"
    maxTokens: int = Field(default=64, ge=1, le=128)
    topKPredictions: int = Field(default=5, ge=1, le=10)
    topKAttentionEdges: int = Field(default=8, ge=1, le=32)

    @field_validator("prompt")
    @classmethod
    def prompt_must_contain_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt must contain text.")
        return value


class Token(BaseModel):
    index: int
    id: int
    text: str
    displayText: str | None = None
    kind: TokenKind = "normal"


class AttentionEdge(BaseModel):
    from_: int = Field(serialization_alias="from")
    to: int
    query: int
    key: int
    weight: float
    head: int


class Feature(BaseModel):
    id: str
    activation: float
    label: str


class LayerState(BaseModel):
    layer: int
    residualNorm: list[float]
    attribution: list[float]
    logitConfidence: list[float]
    topFeature: list[Feature]
    attention: list[AttentionEdge]


class Prediction(BaseModel):
    token: str
    displayToken: str | None = None
    kind: PredictionKind = "normal"
    probability: float


class PromptRun(BaseModel):
    id: str
    title: str
    prompt: str
    model: str
    source: Literal["transformer-lens"]
    featuresAvailable: bool = False
    expectedNextToken: str | None = None
    tokens: list[Token]
    layers: list[LayerState]
    finalPredictions: list[Prediction]
