import mongoose from "mongoose";
import imageSchema from "../../shared/schemas/image.schema.js";

const profileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },

    headline: {
      type: String,
      required: [true, "Headline is required"],
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 5000,
    },

    availability: {
      type: String,
      default: "Open to opportunities",
      trim: true,
      maxlength: 100,
    },

    image: {
      type: imageSchema,
      default: null,
    },

    roles: [
      {
        type: String,
        trim: true,
      },
    ],

    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const Profile = mongoose.model("Profile", profileSchema);

export default Profile;
