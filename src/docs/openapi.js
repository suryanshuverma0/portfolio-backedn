/*
  Hand-authored OpenAPI 3.0 spec (not generated from JSDoc comments) —
  with ~80 endpoints across 17 modules, annotating every route file would
  be a lot of scattered noise for the same result. This stays in one
  place, uses a generator for the repeated public+admin CRUD pattern
  (Education/Experience/Services/Skills/Certificates/Stats) to avoid
  duplicating that block six times, and is hand-written for everything
  shaped differently (Auth, Passkey, Blog, Contact, Analytics...).
*/

const image = {
  type: "object",
  properties: {
    publicId: { type: "string" },
    url: { type: "string", format: "uri" },
  },
  required: ["publicId", "url"],
};

const errorResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    message: { type: "string" },
  },
};

const validationErrorResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    message: { type: "string", example: "Validation failed" },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
};

const rateLimitResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    message: { type: "string", example: "Too many requests" },
    retryAfter: { type: "number", example: 42 },
  },
};

const okEnvelope = (dataSchema) => ({
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
    data: dataSchema,
  },
});

const responses = {
  Validation: {
    description: "Validation failed",
    content: { "application/json": { schema: validationErrorResponse } },
  },
  Unauthorized: {
    description: "Missing/invalid session",
    content: { "application/json": { schema: errorResponse } },
  },
  Forbidden: {
    description: "Not an admin, or access currently restricted",
    content: { "application/json": { schema: errorResponse } },
  },
  NotFound: {
    description: "Not found",
    content: { "application/json": { schema: errorResponse } },
  },
  TooManyRequests: {
    description: "Rate limit exceeded",
    content: { "application/json": { schema: rateLimitResponse } },
  },
};

const cookieAuth = { cookieAuth: [] };

/* ==========================================================================
   Generator for the repeated "public list + admin CRUD" module shape used
   by Education, Experience, Services, Skills, Certificates, and Stats.
========================================================================== */

function crudModule({ tag, base, entityName, itemSchemaName, createSchema, updateSchema, publicSummary, listSummary }) {
  const paths = {};

  paths[`${base}/public`] = {
    get: {
      tags: [tag],
      summary: publicSummary,
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: okEnvelope({ type: "array", items: { $ref: `#/components/schemas/${itemSchemaName}` } }),
            },
          },
        },
      },
    },
  };

  paths[base] = {
    post: {
      tags: [tag],
      summary: `Create a ${entityName} (admin)`,
      security: [cookieAuth],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: `#/components/schemas/${createSchema}` } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: okEnvelope({ $ref: `#/components/schemas/${itemSchemaName}` }) } },
        },
        400: responses.Validation,
        401: responses.Unauthorized,
        403: responses.Forbidden,
      },
    },
    get: {
      tags: [tag],
      summary: listSummary,
      security: [cookieAuth],
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: okEnvelope({ type: "array", items: { $ref: `#/components/schemas/${itemSchemaName}` } }),
            },
          },
        },
        401: responses.Unauthorized,
        403: responses.Forbidden,
      },
    },
  };

  paths[`${base}/{id}`] = {
    put: {
      tags: [tag],
      summary: `Update a ${entityName} (admin)`,
      security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: `#/components/schemas/${updateSchema}` } } },
      },
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: okEnvelope({ $ref: `#/components/schemas/${itemSchemaName}` }) } },
        },
        400: responses.Validation,
        401: responses.Unauthorized,
        403: responses.Forbidden,
        404: responses.NotFound,
      },
    },
    delete: {
      tags: [tag],
      summary: `Delete a ${entityName} (admin)`,
      security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Deleted" },
        401: responses.Unauthorized,
        403: responses.Forbidden,
        404: responses.NotFound,
      },
    },
  };

  return paths;
}

/* ==========================================================================
   Component schemas
========================================================================== */

const schemas = {
  Image: image,
  ErrorResponse: errorResponse,

  // --- Auth ---
  RegisterRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", format: "password", example: "Str0ngPass" },
    },
  },
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", format: "password" },
    },
  },
  ForgotPasswordRequest: {
    type: "object",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
  },
  ResetPasswordRequest: {
    type: "object",
    required: ["password", "confirmPassword"],
    properties: {
      password: { type: "string", format: "password" },
      confirmPassword: { type: "string", format: "password" },
    },
  },
  UserPublic: {
    type: "object",
    properties: {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      role: { type: "string", enum: ["admin", "user"] },
    },
  },
  AdminUser: {
    type: "object",
    properties: {
      email: { type: "string" },
      role: { type: "string", enum: ["admin", "user"] },
      isGoogleUser: { type: "boolean" },
      isActive: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      lastLoginAt: { type: "string", format: "date-time", nullable: true },
    },
  },

  // --- Google Auth ---
  GoogleLoginRequest: {
    type: "object",
    required: ["credential"],
    properties: { credential: { type: "string", description: "Google ID token from the frontend GSI button" } },
  },

  // --- Passkey (WebAuthn) ---
  WebAuthnRegistrationOptions: {
    type: "object",
    description: "PublicKeyCredentialCreationOptionsJSON, passed straight to @simplewebauthn/browser's startRegistration()",
  },
  WebAuthnAuthenticationOptions: {
    type: "object",
    description: "PublicKeyCredentialRequestOptionsJSON, passed straight to @simplewebauthn/browser's startAuthentication()",
  },
  WebAuthnCredentialResponse: {
    type: "object",
    description: "RegistrationResponseJSON or AuthenticationResponseJSON produced by @simplewebauthn/browser",
    properties: {
      id: { type: "string" },
      rawId: { type: "string" },
      type: { type: "string", example: "public-key" },
      response: { type: "object" },
    },
  },
  PasskeyRegistrationVerifyRequest: {
    type: "object",
    required: ["response"],
    properties: {
      response: { $ref: "#/components/schemas/WebAuthnCredentialResponse" },
      name: { type: "string", example: "iPhone" },
    },
  },
  PasskeyAuthVerifyRequest: {
    type: "object",
    required: ["response"],
    properties: { response: { $ref: "#/components/schemas/WebAuthnCredentialResponse" } },
  },
  PasskeySignupOptionsRequest: {
    type: "object",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
  },
  PasskeySignupVerifyRequest: {
    type: "object",
    required: ["email", "response"],
    properties: {
      email: { type: "string", format: "email" },
      response: { $ref: "#/components/schemas/WebAuthnCredentialResponse" },
      name: { type: "string" },
    },
  },
  PasskeyLinkRequestRequest: {
    type: "object",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
  },
  PasskeyLinkOptionsRequest: {
    type: "object",
    required: ["token"],
    properties: { token: { type: "string" } },
  },
  PasskeyLinkVerifyRequest: {
    type: "object",
    required: ["token", "response"],
    properties: {
      token: { type: "string" },
      response: { $ref: "#/components/schemas/WebAuthnCredentialResponse" },
      name: { type: "string" },
    },
  },
  PasskeyRenameRequest: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", example: "Work Laptop" } },
  },
  Passkey: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      deviceType: { type: "string", enum: ["singleDevice", "multiDevice"] },
      backedUp: { type: "boolean" },
      transports: { type: "array", items: { type: "string" } },
      createdAt: { type: "string", format: "date-time" },
      lastUsedAt: { type: "string", format: "date-time", nullable: true },
    },
  },

  // --- Profile ---
  CreateProfileRequest: {
    type: "object",
    required: ["name", "headline", "description"],
    properties: {
      name: { type: "string" },
      headline: { type: "string" },
      description: { type: "string" },
      availability: { type: "string" },
      image: { $ref: "#/components/schemas/Image" },
      roles: { type: "array", items: { type: "string" } },
      isVisible: { type: "boolean" },
    },
  },
  UpdateProfileRequest: { allOf: [{ $ref: "#/components/schemas/CreateProfileRequest" }], description: "All fields optional" },
  Profile: { type: "object", description: "Profile document" },

  // --- Education / Experience / Services / Skills / Certificates / Stats ---
  CreateEducationRequest: {
    type: "object",
    required: ["degree", "institution", "startYear"],
    properties: {
      degree: { type: "string" },
      institution: { type: "string" },
      description: { type: "string" },
      startYear: { type: "number" },
      endYear: { type: "number", nullable: true },
      current: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateEducationRequest: { allOf: [{ $ref: "#/components/schemas/CreateEducationRequest" }] },
  Education: { type: "object", description: "Education document" },

  CreateExperienceRequest: {
    type: "object",
    required: ["role", "company", "startDate", "description"],
    properties: {
      role: { type: "string" },
      company: { type: "string" },
      location: { type: "string" },
      employmentType: {
        type: "string",
        enum: ["Full-time", "Part-time", "Internship", "Contract", "Freelance", "Remote", "Others"],
      },
      startDate: { type: "string" },
      endDate: { type: "string", nullable: true },
      isCurrent: { type: "boolean" },
      description: { type: "string" },
      technologies: { type: "array", items: { type: "string" } },
      companyUrl: { type: "string" },
      featured: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateExperienceRequest: { allOf: [{ $ref: "#/components/schemas/CreateExperienceRequest" }] },
  Experience: { type: "object", description: "Experience document" },

  CreateServiceRequest: {
    type: "object",
    required: ["category", "title", "description"],
    properties: {
      category: {
        type: "string",
        enum: ["Frontend", "Backend", "Full Stack", "Blockchain", "Mobile", "DevOps", "UI/UX", "Other"],
      },
      title: { type: "string" },
      description: { type: "string" },
      technologies: { type: "array", items: { type: "string" } },
      featured: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateServiceRequest: { allOf: [{ $ref: "#/components/schemas/CreateServiceRequest" }] },
  Service: { type: "object", description: "Service document" },

  CreateSkillRequest: {
    type: "object",
    required: ["name", "category"],
    properties: {
      name: { type: "string" },
      category: { type: "string", description: "One of a fixed set of skill categories" },
      featured: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateSkillRequest: { allOf: [{ $ref: "#/components/schemas/CreateSkillRequest" }] },
  Skill: { type: "object", description: "Skill document" },

  CreateCertificateRequest: {
    type: "object",
    required: ["title", "issuer", "year", "image"],
    properties: {
      title: { type: "string" },
      issuer: { type: "string" },
      year: { type: "number" },
      image: { $ref: "#/components/schemas/Image" },
      verifyUrl: { type: "string" },
      featured: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateCertificateRequest: { allOf: [{ $ref: "#/components/schemas/CreateCertificateRequest" }] },
  Certificate: { type: "object", description: "Certificate document" },

  CreateStatRequest: {
    type: "object",
    required: ["label", "value"],
    properties: {
      label: { type: "string" },
      value: { type: "string" },
      section: { type: "string", enum: ["about", "hero", "projects"] },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateStatRequest: { allOf: [{ $ref: "#/components/schemas/CreateStatRequest" }] },
  Stat: { type: "object", description: "Stat document" },

  // --- Projects ---
  CreateProjectRequest: {
    type: "object",
    required: ["slug", "category", "title", "description", "thumbnail"],
    properties: {
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      category: {
        type: "string",
        enum: [
          "Frontend", "Backend", "Full Stack", "Blockchain", "Artificial Intelligence",
          "Mobile", "DevOps", "Software Engineering", "UI/UX", "Other",
        ],
      },
      title: { type: "string" },
      description: { type: "string" },
      thumbnail: { $ref: "#/components/schemas/Image" },
      gallery: { type: "array", items: { $ref: "#/components/schemas/Image" } },
      architectureImages: { type: "array", items: { $ref: "#/components/schemas/Image" } },
      features: { type: "array", items: { type: "string" } },
      technologies: { type: "array", items: { type: "string" } },
      challenges: { type: "array", items: { type: "string" } },
      learnings: { type: "array", items: { type: "string" } },
      evaluation: {
        type: "array",
        items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } } },
      },
      githubUrl: { type: "string" },
      liveUrl: { type: "string" },
      featured: { type: "boolean" },
      order: { type: "number" },
      isVisible: { type: "boolean" },
    },
  },
  UpdateProjectRequest: { allOf: [{ $ref: "#/components/schemas/CreateProjectRequest" }] },
  Project: { type: "object", description: "Project document" },

  // --- Blog ---
  CreatePostRequest: {
    type: "object",
    required: ["title", "slug", "content"],
    properties: {
      title: { type: "string" },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      excerpt: { type: "string" },
      content: { type: "string", description: "Markdown" },
      coverImage: { $ref: "#/components/schemas/Image" },
      tags: { type: "array", items: { type: "string" } },
      isVisible: { type: "boolean" },
    },
  },
  UpdatePostRequest: { allOf: [{ $ref: "#/components/schemas/CreatePostRequest" }] },
  Post: { type: "object", description: "Blog post document" },
  CreateCommentRequest: {
    type: "object",
    required: ["name", "email", "content"],
    properties: {
      name: { type: "string" },
      email: { type: "string", format: "email" },
      content: { type: "string" },
    },
  },
  Comment: { type: "object", description: "Blog comment document" },

  // --- Contact ---
  CreateMessageRequest: {
    type: "object",
    required: ["name", "email", "message"],
    properties: {
      name: { type: "string" },
      email: { type: "string", format: "email" },
      subject: { type: "string" },
      message: { type: "string" },
    },
  },
  ReplyMessageRequest: {
    type: "object",
    required: ["message"],
    properties: { message: { type: "string" } },
  },
  Message: { type: "object", description: "Contact message document" },

  // --- Settings ---
  Socials: {
    type: "object",
    properties: {
      github: { type: "string" },
      leetcode: { type: "string" },
      linkedin: { type: "string" },
      twitter: { type: "string" },
      instagram: { type: "string" },
      facebook: { type: "string" },
    },
  },
  CreateSettingsRequest: {
    type: "object",
    properties: {
      siteTitle: { type: "string" },
      siteDescription: { type: "string" },
      siteKeywords: { type: "array", items: { type: "string" } },
      ogImage: { type: "string" },
      contactEmail: { type: "string" },
      contactPhone: { type: "string" },
      socials: { $ref: "#/components/schemas/Socials" },
      footerName: { type: "string" },
      footerRole: { type: "string" },
      resumeUrl: { type: "string" },
      maintenanceMode: { type: "boolean" },
      publicAccessEnabled: { type: "boolean" },
    },
  },
  UpdateSettingsRequest: { allOf: [{ $ref: "#/components/schemas/CreateSettingsRequest" }] },
  Settings: { type: "object", description: "Settings document (single shared document)" },

  // --- Analytics ---
  TrackRequest: {
    type: "object",
    required: ["path", "visitorId"],
    properties: {
      path: { type: "string" },
      referrer: { type: "string" },
      visitorId: { type: "string" },
    },
  },
  AnalyticsOverview: { type: "object", description: "Views/visitors/devices/referrers breakdown for the requested range" },
  DashboardSummary: { type: "object", description: "Admin dashboard KPI summary" },
  RecentActivityItem: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["project", "certificate", "blog", "comment", "message"] },
      id: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      link: { type: "string" },
    },
  },

  // --- Integrations ---
  GitHubStats: {
    type: "object",
    properties: {
      username: { type: "string" },
      name: { type: "string" },
      avatarUrl: { type: "string" },
      bio: { type: "string" },
      profileUrl: { type: "string" },
      publicRepos: { type: "number" },
      followers: { type: "number" },
      following: { type: "number" },
      totalStars: { type: "number" },
      topRepos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string", nullable: true },
            url: { type: "string" },
            stars: { type: "number" },
            forks: { type: "number" },
            language: { type: "string", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  LeetCodeStats: {
    type: "object",
    properties: {
      username: { type: "string" },
      profileUrl: { type: "string" },
      avatarUrl: { type: "string" },
      ranking: { type: "number" },
      totalSolved: { type: "number" },
      easySolved: { type: "number" },
      mediumSolved: { type: "number" },
      hardSolved: { type: "number" },
    },
  },
  IntegrationsStatus: {
    type: "object",
    properties: {
      github: { $ref: "#/components/schemas/GitHubStats" },
      leetcode: { $ref: "#/components/schemas/LeetCodeStats" },
    },
  },

  // --- Upload ---
  UploadedImage: {
    type: "object",
    properties: {
      publicId: { type: "string" },
      url: { type: "string", format: "uri" },
    },
  },
};

/* ==========================================================================
   Paths
========================================================================== */

const paths = {
  "/": {
    get: {
      tags: ["Health"],
      summary: "API root / liveness check",
      responses: { 200: { description: "OK" } },
    },
  },
  "/api/v1/health": {
    get: {
      tags: ["Health"],
      summary: "Health check (also used by the keep-alive cron)",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  message: { type: "string" },
                  uptime: { type: "number" },
                  timestamp: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
  },

  // --- Auth ---
  "/api/v1/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Register with email/password",
      description: "Rate limited. Blocked for non-admin emails while Settings.publicAccessEnabled is off.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } } },
      responses: {
        201: { description: "Account created, session cookies set", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/UserPublic" }) } } },
        400: responses.Validation,
        403: responses.Forbidden,
        429: responses.TooManyRequests,
      },
    },
  },
  "/api/v1/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login with email/password",
      description: "Rate limited per-IP and per-email.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } } },
      responses: {
        200: { description: "Session cookies set", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/UserPublic" }) } } },
        400: responses.Validation,
        401: { description: "Invalid credentials" },
        403: responses.Forbidden,
        429: responses.TooManyRequests,
      },
    },
  },
  "/api/v1/auth/forgot-password": {
    post: {
      tags: ["Auth"],
      summary: "Request a password reset email",
      description: "Always returns a generic response — never reveals whether the email has an account.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordRequest" } } } },
      responses: { 200: { description: "OK" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/auth/reset-password/{token}": {
    post: {
      tags: ["Auth"],
      summary: "Reset password using the emailed token",
      parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordRequest" } } } },
      responses: { 200: { description: "Password reset" }, 400: responses.Validation, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/auth/refresh-token": {
    post: {
      tags: ["Auth"],
      summary: "Exchange the refresh-token cookie for a new access token",
      responses: { 200: { description: "New access token cookie set" }, 401: responses.Unauthorized, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Logout",
      security: [cookieAuth],
      responses: { 200: { description: "Cookies cleared" }, 401: responses.Unauthorized },
    },
  },
  "/api/v1/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Get the current session's user",
      security: [cookieAuth],
      responses: { 200: { description: "OK" }, 401: responses.Unauthorized },
    },
  },
  "/api/v1/auth/users": {
    get: {
      tags: ["Auth"],
      summary: "List all users (admin)",
      security: [cookieAuth],
      responses: {
        200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/AdminUser" } }) } } },
        401: responses.Unauthorized,
        403: responses.Forbidden,
      },
    },
  },
  "/api/v1/auth/users/{id}": {
    delete: {
      tags: ["Auth"],
      summary: "Delete a user (admin, can't delete self)",
      security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Deleted" }, 400: { description: "Can't delete your own account" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },

  // --- Google Auth ---
  "/api/v1/google-auth/login": {
    post: {
      tags: ["Google Auth"],
      summary: "Login/register with a Google ID token",
      description: "Auto-links to an existing password account with the same verified email. Rate limited.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/GoogleLoginRequest" } } } },
      responses: {
        200: { description: "Session cookies set", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/UserPublic" }) } } },
        400: responses.Validation,
        403: responses.Forbidden,
        429: responses.TooManyRequests,
      },
    },
  },

  // --- Passkey ---
  "/api/v1/passkey/registration/options": {
    post: {
      tags: ["Passkey"],
      summary: "Get WebAuthn registration options (add a passkey to my logged-in account)",
      security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/WebAuthnRegistrationOptions" }) } } }, 401: responses.Unauthorized },
    },
  },
  "/api/v1/passkey/registration/verify": {
    post: {
      tags: ["Passkey"],
      summary: "Verify a new passkey registration for my logged-in account",
      security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyRegistrationVerifyRequest" } } } },
      responses: { 201: { description: "Passkey saved" }, 400: responses.Validation, 401: responses.Unauthorized },
    },
  },
  "/api/v1/passkey/signup/options": {
    post: {
      tags: ["Passkey"],
      summary: "Get registration options for a brand-new passkey-based account",
      description: "Public. Refuses emails that already have an account (409).",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeySignupOptionsRequest" } } } },
      responses: { 200: { description: "OK" }, 400: responses.Validation, 403: responses.Forbidden, 409: { description: "Account already exists" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/signup/verify": {
    post: {
      tags: ["Passkey"],
      summary: "Verify signup and create the new passkey-based account",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeySignupVerifyRequest" } } } },
      responses: { 201: { description: "Account created, session cookies set" }, 400: responses.Validation, 409: { description: "Account already exists" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/link/request": {
    post: {
      tags: ["Passkey"],
      summary: "Email a one-time link to add a passkey to an existing account",
      description: "Public. Always returns a generic response — never reveals whether the email has an account.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyLinkRequestRequest" } } } },
      responses: { 200: { description: "OK" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/link/options": {
    post: {
      tags: ["Passkey"],
      summary: "Get registration options for a link token",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyLinkOptionsRequest" } } } },
      responses: { 200: { description: "OK" }, 400: { description: "Invalid or expired link" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/link/verify": {
    post: {
      tags: ["Passkey"],
      summary: "Verify and complete a passkey account-link",
      description: "Logs the device in immediately on success.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyLinkVerifyRequest" } } } },
      responses: { 201: { description: "Passkey added, session cookies set" }, 400: { description: "Invalid/expired link or failed verification" }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/authentication/options": {
    post: {
      tags: ["Passkey"],
      summary: "Get usernameless WebAuthn login options",
      description: "Public. No allowCredentials — the browser's own discoverable-credential picker decides the account.",
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/WebAuthnAuthenticationOptions" }) } } }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey/authentication/verify": {
    post: {
      tags: ["Passkey"],
      summary: "Verify a passkey login",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyAuthVerifyRequest" } } } },
      responses: { 200: { description: "Session cookies set" }, 400: { description: "Verification failed" }, 403: responses.Forbidden, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/passkey": {
    get: {
      tags: ["Passkey"],
      summary: "List my own passkeys",
      security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/Passkey" } }) } } }, 401: responses.Unauthorized },
    },
  },
  "/api/v1/passkey/{id}": {
    patch: {
      tags: ["Passkey"],
      summary: "Rename one of my passkeys",
      security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PasskeyRenameRequest" } } } },
      responses: { 200: { description: "Renamed" }, 400: responses.Validation, 401: responses.Unauthorized, 404: responses.NotFound },
    },
    delete: {
      tags: ["Passkey"],
      summary: "Delete one of my passkeys",
      security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Deleted" }, 401: responses.Unauthorized, 404: responses.NotFound },
    },
  },

  // --- Profile ---
  "/api/v1/profile/public": {
    get: { tags: ["Profile"], summary: "Get the public profile", responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/Profile" }) } } } } },
  },
  "/api/v1/profile": {
    post: {
      tags: ["Profile"], summary: "Create the profile (admin, one-time)", security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProfileRequest" } } } },
      responses: { 201: { description: "Created" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
    get: {
      tags: ["Profile"], summary: "Get the profile (admin)", security: [cookieAuth],
      responses: { 200: { description: "OK" }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
    put: {
      tags: ["Profile"], summary: "Update the profile (admin)", security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProfileRequest" } } } },
      responses: { 200: { description: "Updated" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },

  // --- Projects (extends the CRUD shape with a public detail route) ---
  "/api/v1/projects/public/{slug}": {
    get: {
      tags: ["Projects"],
      summary: "Get a single public project by slug",
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/Project" }) } } }, 404: responses.NotFound },
    },
  },

  // --- Upload ---
  "/api/v1/upload/image": {
    post: {
      tags: ["Upload"],
      summary: "Upload a single image to Cloudinary (admin)",
      security: [cookieAuth],
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { image: { type: "string", format: "binary" } } } } } },
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/UploadedImage" }) } } }, 400: { description: "Invalid file / too large (max 5MB)" }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/upload/images": {
    post: {
      tags: ["Upload"],
      summary: "Upload up to 10 images to Cloudinary (admin)",
      security: [cookieAuth],
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { images: { type: "array", items: { type: "string", format: "binary" } } } } } } },
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/UploadedImage" } }) } } }, 400: { description: "Invalid file(s)" }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },

  // --- Analytics ---
  "/api/v1/analytics/track": {
    post: {
      tags: ["Analytics"],
      summary: "Record a page view",
      description: "Public, rate limited. Called by the frontend on every route change.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TrackRequest" } } } },
      responses: { 201: { description: "Tracked" }, 400: responses.Validation, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/analytics/overview": {
    get: {
      tags: ["Analytics"],
      summary: "Traffic overview for a date range (admin)",
      security: [cookieAuth],
      parameters: [{ name: "range", in: "query", schema: { type: "integer", default: 30, minimum: 1, maximum: 90 }, description: "Days" }],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/AnalyticsOverview" }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/analytics/dashboard": {
    get: {
      tags: ["Analytics"],
      summary: "Admin dashboard KPI summary",
      security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/DashboardSummary" }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/analytics/recent-activity": {
    get: {
      tags: ["Analytics"],
      summary: "Recent activity feed across Projects/Certificates/Posts/Comments/Messages",
      security: [cookieAuth],
      parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 12, minimum: 1, maximum: 30 } }],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/RecentActivityItem" } }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },

  // --- Settings ---
  "/api/v1/settings/public": {
    get: { tags: ["Settings"], summary: "Get public site settings", responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/Settings" }) } } } } },
  },
  "/api/v1/settings": {
    post: {
      tags: ["Settings"], summary: "Create settings (admin, one-time)", security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateSettingsRequest" } } } },
      responses: { 201: { description: "Created" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
    get: {
      tags: ["Settings"], summary: "Get settings (admin)", security: [cookieAuth],
      responses: { 200: { description: "OK" }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
    put: {
      tags: ["Settings"], summary: "Update settings (admin)", security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateSettingsRequest" } } } },
      responses: { 200: { description: "Updated" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },

  // --- Blog ---
  "/api/v1/blog/public": {
    get: {
      tags: ["Blog"], summary: "List published posts",
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "tag", in: "query", schema: { type: "string" } },
      ],
      responses: { 200: { description: "OK" } },
    },
  },
  "/api/v1/blog/public/tags": {
    get: { tags: ["Blog"], summary: "List all tags in use", responses: { 200: { description: "OK" } } },
  },
  "/api/v1/blog/public/{slug}": {
    get: {
      tags: ["Blog"], summary: "Get a single published post",
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/Post" }) } } }, 404: responses.NotFound },
    },
  },
  "/api/v1/blog/public/{slug}/comments": {
    get: {
      tags: ["Blog"], summary: "List approved comments for a post",
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "OK" }, 404: responses.NotFound },
    },
    post: {
      tags: ["Blog"], summary: "Submit a comment (goes to moderation queue)",
      description: "Rate limited.",
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateCommentRequest" } } } },
      responses: { 201: { description: "Submitted, pending approval" }, 400: responses.Validation, 404: responses.NotFound, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/blog/comments": {
    get: {
      tags: ["Blog"], summary: "List all comments, incl. pending (admin)", security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/Comment" } }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/blog/comments/{id}/approve": {
    put: {
      tags: ["Blog"], summary: "Approve a comment (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Approved" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },
  "/api/v1/blog/comments/{id}": {
    delete: {
      tags: ["Blog"], summary: "Delete a comment (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Deleted" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },
  "/api/v1/blog": {
    post: {
      tags: ["Blog"], summary: "Create a post (admin)", security: [cookieAuth],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePostRequest" } } } },
      responses: { 201: { description: "Created" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
    get: {
      tags: ["Blog"], summary: "List all posts, incl. drafts (admin)", security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/Post" } }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/blog/{id}": {
    get: {
      tags: ["Blog"], summary: "Get a post by id (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "OK" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
    put: {
      tags: ["Blog"], summary: "Update a post (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdatePostRequest" } } } },
      responses: { 200: { description: "Updated" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
    delete: {
      tags: ["Blog"], summary: "Delete a post (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Deleted" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },

  // --- Contact ---
  "/api/v1/contact": {
    post: {
      tags: ["Contact"], summary: "Submit the contact form",
      description: "Public, rate limited. Sends an auto-acknowledgment email.",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateMessageRequest" } } } },
      responses: { 201: { description: "Sent" }, 400: responses.Validation, 429: responses.TooManyRequests },
    },
    get: {
      tags: ["Contact"], summary: "List all messages (admin)", security: [cookieAuth],
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ type: "array", items: { $ref: "#/components/schemas/Message" } }) } } }, 401: responses.Unauthorized, 403: responses.Forbidden },
    },
  },
  "/api/v1/contact/{id}/read": {
    put: {
      tags: ["Contact"], summary: "Mark a message read (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "OK" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },
  "/api/v1/contact/{id}": {
    delete: {
      tags: ["Contact"], summary: "Delete a message (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Deleted" }, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },
  "/api/v1/contact/{id}/reply": {
    post: {
      tags: ["Contact"], summary: "Send a real email reply via Resend (admin)", security: [cookieAuth],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReplyMessageRequest" } } } },
      responses: { 200: { description: "Sent" }, 400: responses.Validation, 401: responses.Unauthorized, 403: responses.Forbidden, 404: responses.NotFound },
    },
  },

  // --- Integrations ---
  "/api/v1/integrations/github": {
    get: {
      tags: ["Integrations"], summary: "Live GitHub profile + top repos",
      description: "Public. Cached 1 hour server-side.",
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/GitHubStats" }) } } }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/integrations/leetcode": {
    get: {
      tags: ["Integrations"], summary: "Live LeetCode solved-problem stats",
      description: "Public. Cached 1 hour server-side.",
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/LeetCodeStats" }) } } }, 429: responses.TooManyRequests },
    },
  },
  "/api/v1/integrations/status": {
    get: {
      tags: ["Integrations"], summary: "GitHub + LeetCode combined (used by the homepage)",
      description: "Public. Each source fails independently — never blocks the other.",
      responses: { 200: { description: "OK", content: { "application/json": { schema: okEnvelope({ $ref: "#/components/schemas/IntegrationsStatus" }) } } }, 429: responses.TooManyRequests },
    },
  },
};

Object.assign(
  paths,
  crudModule({
    tag: "Education", base: "/api/v1/education", entityName: "education entry",
    itemSchemaName: "Education", createSchema: "CreateEducationRequest", updateSchema: "UpdateEducationRequest",
    publicSummary: "List public education entries", listSummary: "List all education entries (admin)",
  }),
  crudModule({
    tag: "Experience", base: "/api/v1/experience", entityName: "experience entry",
    itemSchemaName: "Experience", createSchema: "CreateExperienceRequest", updateSchema: "UpdateExperienceRequest",
    publicSummary: "List public experience entries", listSummary: "List all experience entries (admin)",
  }),
  crudModule({
    tag: "Services", base: "/api/v1/services", entityName: "service",
    itemSchemaName: "Service", createSchema: "CreateServiceRequest", updateSchema: "UpdateServiceRequest",
    publicSummary: "List public services", listSummary: "List all services (admin)",
  }),
  crudModule({
    tag: "Skills", base: "/api/v1/skill", entityName: "skill",
    itemSchemaName: "Skill", createSchema: "CreateSkillRequest", updateSchema: "UpdateSkillRequest",
    publicSummary: "List public skills", listSummary: "List all skills (admin)",
  }),
  crudModule({
    tag: "Certificates", base: "/api/v1/certificates", entityName: "certificate",
    itemSchemaName: "Certificate", createSchema: "CreateCertificateRequest", updateSchema: "UpdateCertificateRequest",
    publicSummary: "List public certificates", listSummary: "List all certificates (admin)",
  }),
  crudModule({
    tag: "Stats", base: "/api/v1/stats", entityName: "stat",
    itemSchemaName: "Stat", createSchema: "CreateStatRequest", updateSchema: "UpdateStatRequest",
    publicSummary: "List public stats", listSummary: "List all stats (admin)",
  }),
  crudModule({
    tag: "Projects", base: "/api/v1/projects", entityName: "project",
    itemSchemaName: "Project", createSchema: "CreateProjectRequest", updateSchema: "UpdateProjectRequest",
    publicSummary: "List public projects", listSummary: "List all projects (admin)",
  }),
);

const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Portfolio CMS API",
    version: "1.0.0",
    description:
      "REST API powering suryanshuverma.com.np — content management, blog, contact, analytics, and multi-method auth " +
      "(email/password, Google OAuth, WebAuthn passkeys). All routes are versioned under /api/v1.\n\n" +
      "Auth uses httpOnly cookies (`accessToken` / `refreshToken`), not bearer tokens — log in via /api/v1/auth/login " +
      "in a browser-based client to exercise protected endpoints from this page.",
    contact: { name: "Suryanshu Verma", url: "https://suryanshuverma.com.np" },
  },
  servers: [
    { url: "https://portfolio-backend-uy0a.onrender.com", description: "Production" },
    { url: "http://localhost:3000", description: "Local development" },
  ],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Google Auth" },
    { name: "Passkey" },
    { name: "Profile" },
    { name: "Education" },
    { name: "Experience" },
    { name: "Services" },
    { name: "Skills" },
    { name: "Certificates" },
    { name: "Projects" },
    { name: "Upload" },
    { name: "Blog" },
    { name: "Contact" },
    { name: "Analytics" },
    { name: "Settings" },
    { name: "Integrations" },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "accessToken",
        description: "httpOnly session cookie set by /auth/login, /google-auth/login, or a passkey login/verify endpoint.",
      },
    },
    schemas,
  },
  paths,
};

export default openapiSpec;
