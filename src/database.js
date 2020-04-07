const mysql = require('mysql');

function database() {
  const handleSqlError = (error) => {
    if (!error) return;

    console.error(`SQL Error: ${error.code}: ${error}`);
    throw error;
  };

  const query = (...args) => {
    let connection = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    });
    connection.on('error', handleSqlError);
    connection.connect(handleSqlError);
    connection.query(...args);
    connection.end(handleSqlError);
  };

  return {
    query,
  };
}

const db = database();

module.exports = db;
