from pydantic import BaseModel, Field


class Params(BaseModel):
    diesel_multiplier: float = Field(1.0, ge=0.1, le=5)
    transport_rate: float = Field(4.5, ge=0)
    carbon_price: float = Field(0, ge=0)
    max_distance: float = Field(300, gt=0)
    virgin_price_multiplier: float = Field(1.0, ge=0.1, le=5)
    processing_multiplier: float = Field(1.0, ge=0, le=5)
    supply_multiplier: float = Field(1.0, ge=0, le=5)
    demand_multiplier: float = Field(1.0, ge=0, le=5)
    min_technical_fit: float = Field(0.4, ge=0, le=1)


class IndustryCreate(BaseModel):
    name: str
    type: str
    cluster: str
    address: str | None = None
    lat: float
    lon: float
    capacity: float = Field(gt=0)
    capacity_unit: str | None = None
    process_description: str | None = None
    declared_wastes: list[str] = []


class InferRequest(BaseModel):
    type: str
    capacity: float = Field(gt=0)
    text: str | None = None


class ClusterParams(BaseModel):
    cluster: str | None = None
    params: Params = Params()
