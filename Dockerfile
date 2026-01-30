FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the code
COPY . .

# Hugging Face Spaces usually uses port 7860
ENV PORT=7860
EXPOSE 7860

# Start the server
CMD ["node", "server.js"]
