import * as mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: '../.env' });

async function run() {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'coderv4',
            ssl: { rejectUnauthorized: false }
        });

        const sql = `DESCRIBE user_academics`;

        console.log("Executing...");
        const [rows] = await conn.execute(sql);
        console.log("Rows:", rows);

        const sql2 = `DESCRIBE users`;
        const [rows2] = await conn.execute(sql2);
        console.log("Users Rows:", rows2);
        process.exit(0);
    } catch (err) {
        console.error("RAW_ERROR:", err);
        process.exit(1);
    }
}
run();
