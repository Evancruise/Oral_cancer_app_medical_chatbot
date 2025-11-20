import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";
dotenv.config();

const swaggerOptions = {
    definition: {
        openai: "3.0.0",
        info: {
            title: "Oral Cancer API Documentation",
            version: "1.0.0",
            description: "API documentation for Android / Web / Flutter integration"
        },
        servers: [
            {
                url: `${process.env.GOOGLE_NODE_APP_URL}/api-docs`, // 部署後改成 Cloud Run / Render 網域
            },
        ],
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT"
            },
        },
    },
    apis: ["./routes/*.js", "./controllers/*.js"],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);

export const setupSwagger = (app) => {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};