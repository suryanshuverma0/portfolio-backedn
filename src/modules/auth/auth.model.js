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
      minlength: 8,
      select: false,
    },

    refreshToken: {
      type: String,
      default: "",
      select: false,
    },

    googleId: {
      type: String,
      default: null,
      index: true,
    },

    role: {
      type: String,
      enum: ["admin", "user"],
      default: "admin",
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

    lastLoginAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Require password only for non-Google users
userSchema.pre("validate", function () {
  if (!this.isGoogleUser && !this.password) {
    this.invalidate("password", "Password is required");
  }

});

// Hash password before save
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return ;
  }

  this.password = await bcrypt.hash(this.password, 12);

});

// Compare password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;

