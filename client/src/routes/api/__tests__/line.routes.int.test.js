import request from "supertest";
import express from "express";
import router from "#routes/api/line.routes.js";
import axios from "axios";

jest.mock("axios");

const app = express();
app.use(express.raw({ type: "application/json" }));
app.use("/", router);

it("should accept image webhook and reply", async () => {
    axios.get.mockResolvedValue({ data: Buffer.from("image")});
    axios.post.mockResolvedValue({ data: { job_id: "job123" }});

    const payload = {
        events: [{
            type: "message",
            replyToken: "token",
            source: { userId: "U123" },
            message: { type: "image", id: "img123" }
        }]
    };

    const res = await request(app)
        .post("/")
        .set("x-line-signature", "fake")
        .send(payload);
    
    expect(res.status).toBe(200);
});



