# PyCodeFlow — Web container Dockerfile
# Locatie op NAS: /volume3/docker/pycodeflow/web/Dockerfile

FROM node:20-alpine

# Werkmap
WORKDIR /app

# Installeer eerst enkel package.json voor betere Docker cache
COPY package.json ./

# Installeer alle npm packages (inclusief pg en pdfkit)
RUN npm install --omit=dev

# Kopieer de rest van de applicatie
COPY . .

# Poort
EXPOSE 3000

# Startcommando
CMD ["node", "server.js"]
