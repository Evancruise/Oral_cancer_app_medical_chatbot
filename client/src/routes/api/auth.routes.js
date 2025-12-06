import express from "express";
import { 
    register,
    loginPage,
    signup,
    signin,
    processing,
    dashboard,
    signout,
    generate_qr,
    verify,
    verify_register,
    quickchangepwd,
    verify_quick_changepwd,
    changepwd,
    verify_changepwd,
    rebind_page,
    resend,
    rebind_qr,
    inference
 } from "#controllers/api/auth.controller.js";

import { request } from "http";
import { getAllUsers } from "#src/services/user.service.js";

const router = express.Router();

router.get('/users', async (req, res, next) => {
    try {
        const allUsers = await getAllUsers();

        res.json({
            message: 'Successfully retrieved users',
            users: allUsers,
            count: allUsers.length,
        });

    } catch(e) {
        console.error(e);
        next(e);
    }
  });

router.get("/register", 
  /* 
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load registration page configuration'
    #swagger.description = 'Returns available registration fields and nextAction information to guide front-end form behavior.' 

    #swagger.responses[200] = {
      description: 'Registration config loaded successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Register page data loaded' },
              data: {
                type: 'object',
                properties: {
                  fields: { 
                    type: 'array',
                    items: { type: 'string' },
                    example: ['name', 'email', 'password', 'confirm_password']
                  },
                  nextAction: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', example: 'submit' },
                      path: { type: 'string', example: '/api/auth/sign-up' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[500] = {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Failed to load registration config' },
              error: { type: 'string', example: 'Internal server error' }
            }
          }
        }
      }
    }
  */
  register
);

router.get("/loginPage", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load login page configuration'
    #swagger.description = 'Returns prefilled login data based on login_role (e.g., professor auto-filled login).'

    #swagger.parameters['login_role'] = {
      in: 'query',
      description: 'User role for login (optional). If professor, name & email will be prefilled.',
      required: false,
      type: 'string',
      example: 'professor'
    }

    #swagger.responses[200] = {
      description: 'Login page data loaded successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Login page data' },
              data: {
                type: 'object',
                properties: {
                  login_role: { type: 'string', example: 'professor' },
                  name: { type: 'string', example: 'Dr. John Doe' },
                  email: { type: 'string', example: 'professor@example.com' }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[500] = {
      description: 'Server error while loading login config',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Failed to load login page data' },
              error: { type: 'string', example: 'Internal server error' }
            }
          }
        }
      }
    }
  */
  loginPage
);

router.post("/sign-up",
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Register new user'
    #swagger.description = 'Creates a new user account after validating input fields.'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["name", "email", "password", "password_2", "role"],
            properties: {
              name: { type: "string", example: "Dr. John Doe" },
              email: { type: "string", example: "doctor@example.com" },
              password: { type: "string", example: "12345678" },
              password_2: { type: "string", example: "12345678" },
              role: { type: "string", example: "professor" }
            }
          }
        }
      }
    }

    #swagger.responses[201] = {
      description: 'User registered successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "User registered successfully" },
              data: {
                type: "object",
                properties: {
                  id: { type: "number", example: 15 },
                  name: { type: "string", example: "Dr. John Doe" },
                  email: { type: "string", example: "doctor@example.com" },
                  role: { type: "string", example: "professor" }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[400] = {
      description: 'Validation failed',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Validation failed" },
              error: { type: "object", example: { email: "Invalid email format" } }
            }
          }
        }
      }
    }

    #swagger.responses[401] = {
      description: 'Passwords do not match',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Passwords do not match" }
            }
          }
        }
      }
    }

    #swagger.responses[409] = {
      description: 'Email already exists',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Email already exists" },
              error: { type: "string", example: "Duplicate email error" }
            }
          }
        }
      }
    }
  */
  signup
);

router.post("/sign-in", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'User Sign-in'
    #swagger.description = 'Authenticate user and return JWT token if credentials are valid.'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", example: "test@example.com" },
              password: { type: "string", example: "12345678" }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'Login successful',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Login successful" },
              data: {
                type: "object",
                properties: {
                  token: { type: "string", example: "jwt-token-string" },
                  user: {
                    type: "object",
                    properties: {
                      id: { type: "number", example: 1 },
                      name: { type: "string", example: "John Doe" },
                      email: { type: "string", example: "test@example.com" },
                      role: { type: "string", example: "professor" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[401] = {
      description: 'Invalid credentials (wrong email or password)',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Wrong password" }
            }
          }
        }
      }
    }

    #swagger.responses[500] = {
      description: 'Internal server error',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
                success: { type: "boolean", example: false },
                message: { type: "string", example: "Login failed" },
                error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */
  signin
);

router.post("/processing",
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Handle login role processing'
    #swagger.description = 'Accepts a login_role from body and returns redirect URL to loginPage with query parameter.'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["login_role"],
            properties: {
              login_role: { type: "string", example: "professor" }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'Login role processed successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Processing login role" },
              data: {
                type: "object",
                properties: {
                  login_role: { type: "string", example: "professor" },
                  redirect: { type: "string", example: "/api/auth/loginPage?login_role=professor" }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[400] = {
      description: 'Missing login_role in request body',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "login_role is required" },
              error: { type: "string", example: "Bad Request" }
            }
          }
        }
      }
    }
  */
  processing
);

router.get("/dashboard", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load dashboard data'
    #swagger.description = 'Verify JWT token and return dashboard information including role priority and user name.'

    #swagger.parameters['token'] = {
        in: 'query',
        required: true,
        description: 'JWT Token for authorization',
        schema: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }
    }

    #swagger.responses[200] = {
      description: 'Dashboard data loaded successfully',
      content: {
        "application/json": {
          schema: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Dashboard data loaded" },
            data: {
              type: "object",
              properties: {
                  name: { type: "string", example: "John Doe" },
                  role: { type: "string", example: "admin" },
                  priority: { type: "number", example: 1 },
                  token: { type: "string", example: "eyJhbGciOi..." }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[401] = {
      description: 'Unauthorized or invalid token',
        content: {
          "application/json": {
            schema: {
            type: "object",
            properties: {
                success: { type: "boolean", example: false },
                message: { type: "string", example: "Unauthorized - invalid token" },
                error: { type: "string", example: "jwt expired" }
            }
          }
        }
      }
    }
  */
  dashboard
);

router.get("signout", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Sign out user'
    #swagger.description = 'Clears JWT token cookie and signs out the user.'

    #swagger.responses[200] = {
      description: 'Signout successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Signout successfully" }
            }
          }
        }
      }
    }
  */
  signout
);

router.post("/request",
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Request email verification'
    #swagger.description = 'User submits name and email to receive a verification code via email.'

    #swagger.parameters['body'] = {
      in: 'body',
      description: 'User email verification request data',
      required: true,
      schema: {
        type: 'object',
        properties: {
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', example: 'john@example.com' }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'Verification email sent successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Verification email sent" },
              data: {
                type: "object",
                properties: {
                  redirect: {
                    type: "string",
                    example: "/api/auth/verify?name=John%20Doe&email=john@example.com&code_hash=xyz123&token=jwt-token"
                  }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[400] = {
      description: 'Missing name or email',
        content: {
          "application/json": {
            schema: {
            type: "object",
            properties: {
                success: { type: "boolean", example: false },
                message: { type: "string", example: "Name and email are required" }
            }
          }
        }
      }
    }

    #swagger.responses[500] = {
      description: 'Server error while verifying email',
        content: {
        "application/json": {
          schema: {
          type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to verify email" },
              error: { type: "string", example: "Error details" }
            }
          }
        }
      }
    }
  */
  request
);

router.get("generate_qr", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Generate QR for account binding or login'
    #swagger.description = 'Generates a temporary QR code with a token and expiration timestamp for scanning.'

    #swagger.responses[200] = {
      description: 'QR code generated successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "QR generated successfully" },
              data: {
                type: "object",
                properties: {
                  qr_token: { type: "string", example: "fb3cb0e0-2261-4386-8d77-2d593a1cbb46" },
                  qrImage: { 
                    type: "string", 
                    example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
                  },
                  expired_at: { 
                    type: "string", 
                    format: "date-time",
                    example: "2025-02-19T14:35:22.123Z"
                  }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[500] = {
        description: 'Failed to generate QR code',
        content: {
        "application/json": {
            schema: {
            type: "object",
            properties: {
                success: { type: "boolean", example: false },
                message: { type: "string", example: "Failed to generate QR code" },
                error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */
  generate_qr
);

router.get("/verify",
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load verify email page data'
    #swagger.description = 'Returns basic information required for email verification, including name, email, and hashed code.'
  
    #swagger.parameters['name'] = {
        in: 'query',
        description: 'User name',
        required: true,
        type: 'string',
        example: 'John Doe'
    }
    #swagger.parameters['email'] = {
        in: 'query',
        description: 'User email address',
        required: true,
        type: 'string',
        example: 'john@example.com'
    }
    #swagger.parameters['code_hash'] = {
        in: 'query',
        description: 'Verification code hash sent by email',
        required: true,
        type: 'string',
        example: '$2b$10$zHZg9QOv4K4JYxzcL6jhFeSI1xD1GJqCk1rmSplZCtu6LJ2hzW6tK'
    }
  
    #swagger.responses[200] = {
      description: 'Verification data loaded successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Load verify page data" },
              data: {
                type: "object",
                properties: {
                  name: { type: "string", example: "John Doe" },
                  email: { type: "string", example: "john@example.com" },
                  code_hash: { type: "string", example: "$2b$10$zHZg9QOv4K4JYxzcL6jhFeSI1xD1GJqCk1rmSplZCtu6LJ2hzW6tK" }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to load verification data',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to load verification data" },
              error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */
  verify
);

router.post("/verify_register", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Verify email registration'
    #swagger.description = 'Validate the email and verification code after the user submits registration form.'
  
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["token", "email", "code", "code_hash"],
            properties: {
              token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI..." },
              email: { type: "string", example: "user@example.com" },
              code: { type: "string", example: "123456" },
              code_hash: { type: "string", example: "$2b$10$abc123hashedcode..." }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Email verified successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Email verified successfully" },
              data: {
                type: "object",
                properties: {
                  email: { type: "string", example: "user@example.com" },
                  name: { type: "string", example: "John Doe" },
                  registered: { type: "boolean", example: true },
                  redirect: { type: "string", example: "/api/auth/changepwd?name=John%20Doe&email=user@example.com" }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Invalid or missing fields / Wrong email / Invalid code',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Invalid verification code" }
            }
          }
        }
      }
    }
  
    #swagger.responses[404] = {
      description: 'Registration record not found',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Registration record not found" }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Server error during verification',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Verification failed" },
              error: { type: "string", example: "jwt malformed" }
            }
          }
        }
      }
    }
  */
  verify_register
);

router.get("/quick_changepwd", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load quick change password page data'
    #swagger.description = 'Validate token from query parameter and return user profile required for quick password change.'
  
    #swagger.parameters['token'] = {
      in: 'query',
      required: true,
      description: 'JWT token for authentication',
      schema: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI...' }
    }
  
    #swagger.responses[200] = {
      description: 'Quick change password data loaded successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Quick change password data loaded" },
              data: {
                type: "object",
                properties: {
                  name: { type: "string", example: "John Doe" },
                  email: { type: "string", example: "john@example.com" },
                  role: { type: "string", example: "professor" },
                  priority: { type: "string", example: "high" },
                  token: { type: "string", example: "eyJh..." }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[401] = {
      description: 'Unauthorized or invalid token',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Invalid or expired token" }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Internal server error',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to load quick change password data" },
              error: { type: "string", example: "jwt malformed" }
            }
          }
        }
      }
    }
  */
  quickchangepwd
);

router.post("/verify_quick_changepwd", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Verify and update password (quick change)'
    #swagger.description = 'Validate old password, ensure new password meets requirements, and update user password. Authorization header required.'
  
    #swagger.parameters['Authorization'] = {
      in: 'header',
      required: true,
      description: 'Bearer token',
      schema: { type: 'string', example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6...' }
    }
  
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string", example: "John Doe" },
              old_password: { type: "string", example: "oldPassword123" },
              new_password: { type: "string", example: "newSecurePassword456" }
            },
            required: ["old_password", "new_password"]
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Password updated successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Password updated successfully" }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'New password does not meet requirements or missing fields',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "New password does not meet requirements" }
            }
          }
        }
      }
    }
  
    #swagger.responses[401] = {
      description: 'Invalid old password or unauthorized',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Old password is incorrect" }
            }
          }
        }
      }
    }
  
    #swagger.responses[404] = {
      description: 'User not found',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "User not found" }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Server error updating password',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to update password" },
              error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */
  verify_quick_changepwd
);

router.post("/resend", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Resend verification email'
    #swagger.description = 'Resends the verification email to the user with a new code hash and a verify action URL.'
  
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string", example: "John Doe" },
              email: { type: "string", example: "john@example.com" }
            },
            required: ["name", "email"]
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Verification email sent successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Verification email sent successfully" },
              data: {
                type: "object",
                properties: {
                  name: { type: "string", example: "John Doe" },
                  email: { type: "string", example: "john@example.com" },
                  code_hash: { type: "string", example: "$2b$10$d9g2hf..." },
                  nextAction: {
                    type: "object",
                    properties: {
                      type: { type: "string", example: "verify_code" },
                      path: { type: "string", example: "/api/auth/verify" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Missing required fields',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Missing required fields: name, email" }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to resend verification email',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to resend verification email" },
              error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */
  resend
);

router.get("/changepwd", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load change password page data'
    #swagger.description = 'Returns basic user information (name, email) for change password page initialization.'
  
    #swagger.parameters['name'] = {
      in: 'query',
      description: 'User name',
      required: true,
      type: 'string',
      example: 'John Doe'
    }
  
    #swagger.parameters['email'] = {
      in: 'query',
      description: 'User email address',
      required: true,
      type: 'string',
      example: 'john@example.com'
    }
  
    #swagger.responses[200] = {
      description: 'Change password page data loaded successfully',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: { type: "string", example: "Change password page data" },
              data: {
                type: "object",
                properties: {
                  name: { type: "string", example: "John Doe" },
                  email: { type: "string", example: "john@example.com" }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to load password change page data',
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              message: { type: "string", example: "Failed to load password change" },
              error: { type: "string", example: "Internal server error" }
            }
          }
        }
      }
    }
  */  
  changepwd
);

router.post("/verify_changepwd", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Verify and change password'
    #swagger.description = 'Validate user identity by name and email, confirm new password input matches, then update password successfully.'
  */
  verify_changepwd
);

router.get("/rebind_page", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Load rebind account page data'
    #swagger.description = 'Validate token and return data required for rebind account page (Android / API version).'
  */
  rebind_page
);

router.get("/rebind-qr", 
  /*
    #swagger.tags = ['Auth']
    #swagger.summary = 'Generate QR code for account rebind'
    #swagger.description = 'Returns a Base64 encoded QR image and unique token for binding process.'
  */
  rebind_qr
);

router.post("/infer",
  /*
  */
 inference
);

export default router;