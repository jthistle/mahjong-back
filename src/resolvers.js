const crypto = require('crypto');
const db = require('./database.js');

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    hello: () => 'Hello world!',
  },

  Mutation: {
    createUser: (parent, args, context, info) => {
      const hash = crypto.randomBytes(32).toString('hex');
      db.query('INSERT INTO users (hash, nickname) VALUES (?, ?)', [
        hash,
        args.nickname,
      ]);

      return hash;
    },
  },
};

module.exports = resolvers;
