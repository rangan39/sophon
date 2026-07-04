from pydantic import BaseModel, Field


class RunRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=280)
    model: str = "gpt2-small"
    maxTokens: int = Field(default=64, ge=1, le=128)
    topKPredictions: int = Field(default=5, ge=1, le=10)
    topKAttentionEdges: int = Field(default=8, ge=1, le=32)


class Token(BaseModel):
    index: int
    id: int
    text: str


class AttentionEdge(BaseModel):
    from_: int = Field(serialization_alias="from")
    to: int
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
    probability: float


class PromptRun(BaseModel):
    id: str
    title: str
    prompt: str
    model: str
    source: str
    expectedNextToken: str | None = None
    tokens: list[Token]
    layers: list[LayerState]
    finalPredictions: list[Prediction]
