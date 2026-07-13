# Backend Setup Instructions

## 1. Create a `.env` File
Create a `.env` file in the `backend` directory with the following content:
```
DATABASE_URL=postgres://username:password@host:port/database
PORT=5000
```
- Replace `username`, `password`, `host`, `port`, and `database` with your PostgreSQL credentials.

## 2. Start the Backend
Run the following commands to start the backend server:
```bash
cd backend
npm install
node server.js or npm start
```
The backend will start on `http://localhost:5000`.

## 3. Start the Frontend
Navigate to the `react-user-dashboard` directory and run:
```bash
cd react-user-dashboard
npm install
npm run dev
```
The frontend will start on `http://localhost:5173`.

## 4. Database Table Creation
The backend automatically creates the `users` table and populates it with a default user if the table does not exist. The default user is:
- **Email**: `admin@example.com`
- **Password**: `admin123`

## 5. Sign-Up and Sign-In Instructions
### Sign-Up
1. Navigate to `http://localhost:5173/signup`.
2. Enter your email and password to create a new account.

### Sign-In
1. Navigate to `http://localhost:5173/login`.
2. Enter your email and password to log in.

If you encounter any issues, please check the backend logs for errors.
