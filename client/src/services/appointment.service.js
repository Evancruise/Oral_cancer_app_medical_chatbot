import { sql2 } from "#config/database.js";

/******************************
 
Fetch functions

******************************/

export const fetchAllAppointments = async () => {
    try {
        console.log('Getting appointments table...');

        const allAppointments = await getAllAppointments();
        
        res.json({
            message: 'Successfully retrieved appointments',
            users: allAppointments,
            count: allAppointments.length,
        });

    } catch (err) {
        console.error("Error getting appointment_data", e);
        throw e;
    }
};

export const getAllAppointments = async () => {
    try {
        const result = await sql2`
          SELECT * FROM appointment_data
        `;
        return result;
    } catch (e) {
        console.error("Error getting appointment_data", e);
        throw e;
    }
};

export const getAppointment = async (key, value) => {
    let result = null;
    if (key === "name") {
        result = await sql2`SELECT * FROM appointment_data WHERE name = ${value}`;
    } else if (key === "email") {
        result = await sql2`SELECT * FROM appointment_data WHERE email = ${value}`;
    }
    return result;
};

/******************************

Remove functions

*******************************/

export const removeAppointmentTable = async () => {
  try {
    console.log("🔍 刪除 appointment_data 資料表中...");
    await sql`DROP TABLE IF EXISTS appointment_data`;
    console.log("✅ 刪除 appointment_data 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 appointment_data 資料表失敗:", e);
    throw e;
  }
};

export const deleteAppointmentTable = async (body) => {
  try {
    // raw SQL 查詢
    const existingAppointment = await sql2`SELECT * FROM appointment_data WHERE date = ${body.date}`;

    console.log("✅ Step 1 結果:", existingAppointment);

    if (existingAppointment.length === 0) {
      throw new Error(`Appointment with date ${body.date} has already deleted`);
    }

    await sql`DELETE FROM appointment_data 
        WHERE date = ${body.date}
    `;

    console.log("✅ Step 2 完成");
  } catch (err) {
    console.error("❌ deleteAppointmentTable 發生錯誤:", e);
    throw e;
  }
};

export const deleteAppoint = async (body) => {
  try {
    // raw SQL 查詢
    const existingAppointment = await sql2`SELECT * FROM appointment_data WHERE name = ${body.name}`;

    console.log("✅ Step 1 結果:", existingAppointment);

    if (existingAppointment.length === 0) {
      throw new Error(`Appointment with name ${body.name} has already deleted`);
    }

    await sql`DELETE FROM appointment_data 
        WHERE name = ${body.name}
    `;

    console.log("✅ Step 2 完成");
  } catch (err) {
    console.error("❌ deleteAppointment 發生錯誤:", e);
    throw e;
  }
}

/******************************

Create functions

*******************************/

export const createAppointmentTable = async () => {
    try {
        console.log("🔍 建立 users 資料表中...");

        await sql2`CREATE TABLE IF NOT EXISTS appointment_data (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE,
            email VARCHAR(255) UNIQUE,
            date TIMESTAMPTZ DEFAULT NOW(),
            doctor_name TEXT,
            location TEXT,
            notify_switch BOOLEAN DEFAULT false,
            checkin BOOLEAN DEFAULT false,
            notify_timer TEXT,
            notes TEXT
        )`;

    } catch (err) {
        console.error("❌ createAppointmentTable 發生錯誤:", err);
        throw err;
    }
};

export const createAppointment = async (body) => {

    console.log(`[createAppointment] body: ${JSON.stringify(body)}`);

    const { name, token, email, date, doctor_name, location, notify_switch, notify_timer, notes } = body;

    console.log(name, token, email, date, doctor_name, location, notify_switch, notify_timer, notes);

    /*
    "name":"admin",
    "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwibmFtZSI6ImFkbWluIiwiZW1haWwiOiJhZG1pbkBnbWFpbC5jb20iLCJwYXNzd29yZCI6IiQyYiQxMCRGUGpJVVFCU2dKdGtzaU9BS0lwSi5lMkRXZ1RLVktENmpSaDhCUkJycEFJUXZ6eFZXRzlLaSIsInJvbGUiOiJzeXN0ZW0gbWFuYWdlciIsImxvZ2luX3JvbGUiOiJwcm9mZXNzb3IiLCJpYXQiOjE3NjE5MzI3ODAsImV4cCI6MTc2MTkzNjM4MH0.HSi3T8Hh26lZAlJwQHiO5I2zUCpq2OkO3ldgniyI-V4",
    "email":"admin@gmail.com",
    "date":"2025-11-01T13:49",
    "doctor_name":"Allan",
    "location":"信義區B棟",
    "notify_switch":true,
    "notify_timer":"前 1 天",
    "notes":"","action":"create"
    */
    //try {
        // raw SQL 查詢
        const existingAppointmentData = await sql`SELECT * FROM appointment_data WHERE email = ${email}`;
        
        console.log("✅ Step 1 結果:", existingAppointmentData);

        if (existingAppointmentData.length > 0) {
            throw new Error(`Appointments with email ${email} already exists`);
        }

        console.log(`
            INSERT INTO appointment_data (name, email, date, doctor_name, location, notify_switch, notify_timer, notes)
            VALUES (${name}, ${email}, ${date}, ${doctor_name}, ${location}, ${notify_switch}, ${notify_timer}, ${notes})
            RETURNING *`);

        const createAppointmentData = await sql2`
            INSERT INTO appointment_data (name, email, date, doctor_name, location, notify_switch, notify_timer, notes)
            VALUES (${name}, ${email}, ${date}, ${doctor_name}, ${location}, ${notify_switch}, ${notify_timer}, ${notes})
            RETURNING *`;
        
        console.log("✅ Step 2 完成:", createAppointmentData[0]);
        return createAppointmentData[0];
    //} catch (err) {
    //    console.error("❌ createAppointments 發生錯誤:", err);
    //    throw err;
    //}
};

/******************************

Update functions

*******************************/

export const updateAppointment = async (body) => {
    try {
        console.log(`[updateAppointment] body: ${JSON.stringify(body)}`);
        const { name, token, email, date, doctor_name, location, notify_switch, notify_timer, notes } = body;

        // raw SQL 查詢
        const existingAppointmentData = await sql2`SELECT * FROM appointment_data WHERE name = ${name}`;
        console.log("✅ Step 1 結果:", existingAppointmentData);

        if (existingAppointmentData.length === 0) {
            throw new Error(`Appointments with name ${name} not exists`);
        }
        
        const updated = await sql2`UPDATE appointment_data
        SET date = ${date}, doctor_name = ${doctor_name}, location = ${location}, notify_switch = ${notify_switch}, notify_timer = ${notify_timer}, notes = ${notes}
        WHERE name = ${name}
        RETURNING *
        `;

        console.log("✅ Step 2 完成:", updated[0]);
        return updated[0];
    } catch (err) {
        console.error("❌ updateAppointment 發生錯誤:", err);
        throw err;
    }
};

export const updateAppointmentStatus = async (name, date, fieldname, value) => {
    try {
        // raw SQL 查詢
        const existingAppointmentData = await sql2`SELECT * FROM appointment_data WHERE name = ${name} AND date = ${date}`;
        console.log("✅ Step 1 結果:", existingAppointmentData);

        if (existingAppointmentData.length === 0) {
            throw new Error(`Appointments with name ${name} not exists`);
        }

        if (fieldname === "checkin") {
            const updated = await sql2`UPDATE appointment_data
                SET checkin = ${value} 
                WHERE name = ${name} AND date = ${date} 
                RETURNING *
                `;
            
            console.log("✅ Step 2 完成:", updated[0]);
            return updated[0];
        }
    } catch (err) {
          console.error("❌ updateAppointmentStatus 發生錯誤:", err);
          throw err;
    }
};