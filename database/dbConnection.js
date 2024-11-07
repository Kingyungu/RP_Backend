// database/dbConnection.js
import mongoose from "mongoose";
import { initGridFS } from "../utils/gridfsStorage.js";

export const dbConnection = () => {
  mongoose
    .connect(process.env.MONGO_URI, {
      dbName: "MERN_JOB_SEEKING_WEBAPP",
    })
    .then(() => {
      console.log("Connected to database.");
      initGridFS(); // Initialize GridFS after connection
    })
    .catch((err) => {
      console.log(`Some Error occured. ${err}`);
    });
};