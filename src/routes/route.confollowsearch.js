import express from "express";
import {
  createConFollowSearch,
  deleteConFollowSearch,
  getConFollowSearch,
  getConFollowSearchById,
  updateConFollowSearch,
} from "../controllers/controller.confollowsearch.js";

import { validate } from "../middlewares/validate.js";
import {
  createConFollowSearchValidator,
  updateConFollowSearchValidator,
} from "../validators/confollowsearchvalidator.js";

const confollowsearchRoutes = express.Router();

confollowsearchRoutes.get("/", getConFollowSearch);
confollowsearchRoutes.get("/:id", getConFollowSearchById);
confollowsearchRoutes.post(
  "/",
  validate(createConFollowSearchValidator),
  createConFollowSearch
);
confollowsearchRoutes.put(
  "/:id",
  validate(updateConFollowSearchValidator),
  updateConFollowSearch
);
confollowsearchRoutes.delete("/:id", deleteConFollowSearch);

export default confollowsearchRoutes;
