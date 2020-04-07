const mysql = require('mysql');

function database() {
  let connection;

  const handleSqlError = (error) => {
    if (!error) return;

    console.error(`SQL Error: ${error.code}: ${error}`);
    if (error.code === 'PROTOCOL_CONNECTION_LOST') {
      restartSqlConnection();
    } else {
      throw error;
    }
  };

  const restartSqlConnection = () => {
    connection = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    });

    connection.on('error', handleSqlError);
  };

  const query = (...args) => {
    connection.connect(handleSqlError);
    connection.query(...args);
    connection.end(handleSqlError);
  };

  restartSqlConnection();

  return {
    query,
  };
}

const db = database();

module.exports = db;
