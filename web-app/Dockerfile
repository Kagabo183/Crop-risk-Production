# Development Dockerfile for Web App
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port (Vite default)
EXPOSE 5174

# Start dev server with host flag to allow access from outside the container
CMD ["npm", "run", "dev", "--", "--host"]
