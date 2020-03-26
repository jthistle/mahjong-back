const mysql = require('mysql');

var connection;

function handleSqlError(error) {
  if (!error) return;

  console.error(`SQL Error: ${error.code}: ${error}`);
  if (error.code === 'PROTOCOL_CONNECTION_LOST') {
    restartSqlConnection();
  } else {
    throw error;
  }
}

function restartSqlConnection() {
  connection = mysql.createConnection({
    host: 'localhost',
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  connection.connect(handleSqlError);

  connection.on('error', handleSqlError);
}

module.exports = connection;
