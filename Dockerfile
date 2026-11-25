FROM node:22.23.5-slim

WORKDIR /app
COPY . /app

RUN npm install

# We dont use 'npm run prod' because npm doesn't pass unix signals properly
CMD [ "node", "/app/bin/www.js" ]