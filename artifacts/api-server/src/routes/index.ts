import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import imagesRouter from "./images";
import storageRouter from "./storage";
import authRouter from "./auth";
import projectsRouter from "./projects";
import cinemaRouter from "./cinema";
import videoStudioRouter from "./video-studio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(imagesRouter);
router.use(storageRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(cinemaRouter);
router.use(videoStudioRouter);

export default router;
