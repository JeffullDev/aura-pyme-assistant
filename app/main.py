import logging

from fastapi import FastAPI

from app.api.chat import router as chat_router
from app.api.health import router as health_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AURA - Asistente PYME")

app.include_router(health_router)
app.include_router(chat_router)
