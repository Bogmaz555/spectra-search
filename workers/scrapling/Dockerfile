# Local-only image. Publish it as 127.0.0.1:8765:8765.
# This file was not built in the review environment: Docker was not installed there.
FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m patchright install chromium \
    && chown -R nobody:nogroup /ms-playwright

COPY --chown=nobody:nogroup guard.py egress.py extract.py worker.py ./
ENV WORKER_IN_DOCKER=1
ENV HOME=/tmp
EXPOSE 8765
USER nobody
CMD ["python", "worker.py", "--host", "0.0.0.0", "--port", "8765"]
