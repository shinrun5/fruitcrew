"""
FastAPI wrapper around engine.solve().

Run (from Solver/):
    uvicorn service:app --reload --port 8000

The Express backend calls POST /solve with the payload built from the DB.
"""

from fastapi import FastAPI
from pydantic import BaseModel

from engine import solve

app = FastAPI(title="Scheduler Solver", version="0.1.0")


class EmployeeStore(BaseModel):
    storeId: int
    tier: str = "REGULAR"
    canOpen: bool = False
    primary: bool = True  # False -> a cross-store assignment here is soft-penalised


class Employee(BaseModel):
    id: int
    name: str = ""
    hourLimit: int | None = None
    maxShifts: int | None = None
    stores: list[EmployeeStore] = []
    # "schedule me at most one of these days" groups, e.g. [["SATURDAY","SUNDAY"]]
    eitherOr: list[list[str]] = []
    # never two back-to-back days in a week
    noConsecutive: bool = False
    # never a partial/split day at a store: every requirement window it has
    # that day, or none of them
    fullDayOnly: bool = False


class Availability(BaseModel):
    employeeId: int
    day: str
    start: str  # "HH:MM" 24h
    end: str


class Requirement(BaseModel):
    id: int
    storeId: int
    day: str
    start: str  # "HH:MM" 24h
    end: str
    head: int = 1
    seniorMin: int = 0
    needOpen: bool = False
    allowNew: bool = True
    pairNew: bool = False  # a NEW worker on this window needs a REGULAR+ coworker on it too
    graceMinutes: int = 0  # availability may begin this many min after `start` and still count
    # nobody works more than one window at this store on this day (set on every
    # window of the day): two morning people + two *different* night people
    noBackToBack: bool = False


class SolveRequest(BaseModel):
    employees: list[Employee]
    availability: list[Availability] = []
    requirements: list[Requirement]
    solveSeconds: float = 5.0


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/solve")
def solve_endpoint(req: SolveRequest) -> dict:
    return solve(req.model_dump())
