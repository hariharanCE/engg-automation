FROM node:20-bookworm-slim

# Python for the course-planner scripts (openpyxl is vendored in backend/scripts/vendor)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

# Templates + holiday workbook live at the repo root; coursePlanner.js reads them from /app
COPY *.xlsx /app/

ENV NODE_ENV=production
CMD ["node", "index.js"]