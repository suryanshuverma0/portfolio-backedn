import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,

      required: [true, "Email is required"],

      unique: true,

      lowercase: true,

      trim: true,

      index: true,
    },

    password: {
      type: String,

      required: [true, "Password is required"],

      minlength: 8,

      select: false,
    },

    refreshToken: {
      type: String,

      default: "",
    },

    googleId: {
      type: String,

      default: null,
    },

    role: {
      type: String,

      enum: ["admin", "user"],

      default: "user",
    },

    isGoogleUser: {
      type: Boolean,

      default: false,
    },

    is2FAEnabled: {
      type: Boolean,

      default: false,
    },

    twoFactorSecret: {
      type: String,

      default: null,

      select: false,
    },

    passwordResetToken: {
      type: String,

      default: null,

      select: false,
    },

    passwordResetExpires: {
      type: Date,

      default: null,

      select: false,
    },
  },

  {
    timestamps: true,
  },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
