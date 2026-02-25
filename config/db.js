const mongoose = require('mongoose');

const ATLAS_WHITELIST_MSG = `
--- MongoDB Atlas: fix connection ---
Your IP is not allowed. In Atlas:
1. Open https://cloud.mongodb.com → your project → Network Access
2. Click "Add IP Address"
3. Add your current IP, or use 0.0.0.0/0 to allow from anywhere (dev only)
4. Save and wait ~1 minute, then restart the server
---`;

const connectDB = async () => {
  let uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is not defined. Add it to .env (see .env.example).');
    }
    uri = 'mongodb://localhost:27017/guidexpert';
    console.warn('[db] MONGODB_URI not set — using dev default:', uri);
  }

  const isAtlas = uri.includes('mongodb.net');
  const options = {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  };

  try {
    console.log('Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(uri, options);

    console.log(`✓ MongoDB Connected: ${conn.connection.host}`);
    console.log(`✓ Database: ${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected.');
    });
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected.');
    });

    return conn;
  } catch (error) {
    const isWhitelistError =
      error.message && (
        error.message.includes('whitelist') ||
        error.message.includes('Could not connect to any servers')
      );

    if (isAtlas && isWhitelistError) {
      console.error('MongoDB connection error: IP not whitelisted in Atlas.');
      console.error(ATLAS_WHITELIST_MSG);
    } else {
      console.error('MongoDB connection error:', error.message);
    }

    // Optional: try fallback URI (e.g. local MongoDB) if primary is Atlas and failed
    const fallbackUri = process.env.MONGODB_URI_FALLBACK;
    if (
      isAtlas &&
      isWhitelistError &&
      fallbackUri &&
      fallbackUri !== uri &&
      !fallbackUri.includes('mongodb.net')
    ) {
      console.log('Trying fallback MongoDB URI...');
      try {
        const conn = await mongoose.connect(fallbackUri, options);
        console.log(`✓ MongoDB Connected (fallback): ${conn.connection.host}`);
        return conn;
      } catch (fallbackErr) {
        console.error('Fallback MongoDB failed:', fallbackErr.message);
      }
    }

    throw error;
  }
};

module.exports = connectDB;
