FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY paperlog ./paperlog
ENV PORT=8080
CMD ["sh", "-c", "uvicorn paperlog.api:app --host :: --port ${PORT}"]
