# Preparation only. The evidence manifest uses the resulting immutable image ID.
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium postgresql-client \
    && rm -rf /var/lib/apt/lists/*
