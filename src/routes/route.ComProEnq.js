import express from "express";
import {
  createComProEnq,
  deleteComProEnq,
  getComProEnq,
  getComProEnqById,
  updateComProEnq,
} from "../controllers/controller.comproenq.js";

import { validate } from "../middlewares/validate.js";
import {
  createComProEnqValidator,
  updateComProEnqValidator,
} from "../validators/conproenqvalidator.js";

const comProEnqRoutes = express.Router();

comProEnqRoutes.get("/", getComProEnq);
comProEnqRoutes.get("/:id", getComProEnqById);
comProEnqRoutes.post("/", validate(createComProEnqValidator), createComProEnq);
comProEnqRoutes.put(
  "/:id",
  validate(updateComProEnqValidator),
  updateComProEnq
);
comProEnqRoutes.delete("/:id", deleteComProEnq);

export default comProEnqRoutes;
