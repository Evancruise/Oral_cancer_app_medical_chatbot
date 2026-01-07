import { describe, it, expect } from "@jest/globals";
import crypto from "crypto";
import { pollInferenceDoneJobs, verifyLineSignature } from "../line.service";

it("should verify correct LINE signature", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const secret = "test-secret";

    process.env.LINE_CHANNEL_SECRET = secret;

    const signature = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("base64");
    
    const req = {
        rawBody: body,
        headers: { "x-line-signature": signature }
    };

    expect(verifyLineSignature(req)).toBe(true);
});

it("should process DONE jobs", async () => {
    const jobs = [
        { data: () => ({ job_id: "1", notified: false })},
        { data: () => ({ job_id: "2", notified: false })}
    ];

    const snapshot = { doc: jobs };

    const dbMock = {
        collection: () => ({
            where: () => ({
                where: () => ({
                    limit: () => ({
                        get: async () => snapshot
                    })
                })
            })
        })
    };

    const handler = jest.fn();

    await pollInferenceDoneJobs({
        db: dbMock,
        pushMessage: jest.fn(),
        getSignedUrl: jest.fn(),
        liffId: "LIFF",
        frontedBaseUrl: "x",
        handleInferenceDone: handler
    });

    expect(handler).toHaveBeenCalledTimes(2);
});

