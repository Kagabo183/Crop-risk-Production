# Development Dockerfile for Mobile App
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port (Vite default for mobile)
EXPOSE 5175

# Start dev server with host flag
CMD ["npm", "run", "dev", "--", "--host"]
