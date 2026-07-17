import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.115.0,<1",
        "pydantic>=2.8.0,<3",
        "torch>=2.4.0,<3",
        "transformer-lens>=2.16.0,<3",
    )
    .add_local_python_source("sophon_interp")
)

app = modal.App("sophon-interp-api", image=image)


@app.function(
    gpu="T4",
    timeout=300,
    min_containers=1,
    scaledown_window=1200,
)
@modal.asgi_app()
def fastapi_app():
    from sophon_interp.api import create_app

    return create_app()
