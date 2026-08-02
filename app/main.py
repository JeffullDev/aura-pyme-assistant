import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.chat import router as chat_router
from app.api.health import router as health_router

logging.basicConfig(level=logging.INFO)

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="AURA - Asistente PYME")

app.include_router(health_router)
app.include_router(chat_router)
app.include_router(admin_router)


@app.get("/", include_in_schema=False)
def serve_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/admin", include_in_schema=False)
def serve_admin() -> FileResponse:
    return FileResponse(STATIC_DIR / "admin.html")


# Montado al final: /health, /chat, /admin/* y /admin ya quedaron registrados
# arriba y se resuelven antes de que Starlette caiga en este mount para
# cualquier otra ruta.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
