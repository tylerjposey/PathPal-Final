import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof error === "object" && error !== null && "status" in error &&
    typeof error.status === "number" ? error.status : 500;
  const message = status === 413 ? "Request body exceeds the allowed size." :
    status === 400 ? "Request body is invalid." : "The request could not be completed.";
  res.status(status).json({ error: message });
});

export default app;
