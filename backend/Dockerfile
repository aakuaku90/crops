FROM python:3.11-slim

# System deps for Prophet (pystan/cmdstanpy) and LightGBM. Without these the
# pip install fails on the slim image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Heroku assigns $PORT; bind there. Locally `docker run -p 8000:8000` still
# works because $PORT defaults to 8000. Shell form is required so the env
# variable is expanded.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
