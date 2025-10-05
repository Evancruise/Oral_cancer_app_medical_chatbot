import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.render("login", { title: "Oral Cancer Webapp" });
});

app.listen(process.env.PORT || 7860, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${process.env.PORT || 7860}`)
);
