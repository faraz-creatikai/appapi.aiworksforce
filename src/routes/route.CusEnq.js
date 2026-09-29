import express from "express";
import {
  createCusEnq,
  deleteCusEnq,
  getCusEnq,
  getCusEnqById,
  updateCusEnq,
} from "../controllers/controller.CusEnq.js";

import { validate } from "../middlewares/validate.js";
import {
  createCusEnqValidator,
  updateCusEnqValidator,
} from "../validators/cusEnqvalidator.js";

const cusEnqRoutes = express.Router();

cusEnqRoutes.get("/", getCusEnq);
cusEnqRoutes.get("/:id", getCusEnqById);
cusEnqRoutes.post("/", validate(createCusEnqValidator), createCusEnq);
cusEnqRoutes.put("/:id", validate(updateCusEnqValidator), updateCusEnq);
cusEnqRoutes.delete("/:id", deleteCusEnq);

export default cusEnqRoutes;
