FROM python:3.12-slim

WORKDIR /app

# dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# code kopiëren
COPY app.py /app/app.py

# 🔥 correcte rechten instellen
RUN chmod 755 /app \
    && chmod 644 /app/app.py \
    && chmod 644 /app/requirements.txt

# 🔒 veilige user
RUN useradd -m appuser
USER appuser

EXPOSE 5000

# 🚀 gunicorn in productie i.p.v. Flask dev-server
#    -w 1        → 1 worker-proces (genoeg, threading doet het zware werk)
#    -k gthread  → thread-gebaseerde worker
#    --threads 8 → max 8 gelijktijdige requests per worker
CMD ["gunicorn", "-w", "1", "-k", "gthread", "--threads", "8", "-b", "0.0.0.0:5000", "--timeout", "30", "app:app"]
