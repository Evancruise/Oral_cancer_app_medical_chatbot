import { 
    guideline,
    privacy_setting,
    save_privacy_setting,
    apply_system_setting,
    web_setting,
    education,
    sys_import,
    sys_export,
    reset
} from "#controllers/api/system.controller.js";
import { authenticateToken } from "#src/middleware/users.middleware.js";
import express from "express";
import multer from "multer";

const router = express.Router();
const upload = multer();

router.get("/privacy_setting", authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Load privacy settings'
  #swagger.description = 'Retrieve user privacy preferences, role, and priority using JWT (Authorization header recommended).'
  #swagger.security = [{
    bearerAuth: []
  }]
  #swagger.parameters['Authorization'] = {
    in: 'header',
    description: 'JWT token (format: Bearer <token>)',
    required: true,
    schema: { type: 'string' },
    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  }
  #swagger.responses[200] = {
    description: 'Privacy settings loaded successfully',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Privacy settings loaded' },
            data: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'doctor' },
                priority: { type: 'number', example: 2 }
              }
            }
          }
        }
      }
    }
  }
  #swagger.responses[401] = {
    description: 'Unauthorized',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Unauthorized' }
          }
        }
      }
    }
  }
  #swagger.responses[500] = {
    description: 'Internal error',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Failed to load privacy settings' },
            error: { type: 'string', example: 'Internal server error' }
          }
        }
      }
    }
  }
*/ privacy_setting);

router.post("/save_privacy_setting", authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Save or update user privacy settings'
  #swagger.description = 'Update privacy preferences for authenticated users. Only allowed fields will be updated including analysis sharing, research participation, and notification preferences.'

  #swagger.security = [{ "bearerAuth": [] }]

  #swagger.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: {
          shareAnalysis: true,
          allowResearch: false,
          notifyResult: true,
          notifyReminder: false
        }
      }
    }
  }

  #swagger.responses[200] = {
    description: 'Privacy settings updated successfully',
    schema: {
      success: true,
      message: 'Privacy settings saved successfully',
      data: {
        userId: '64b123ac987f',
        updatedFields: {
          shareAnalysis: true,
          allowResearch: false,
          notifyResult: true,
          notifyReminder: false
        },
        nextAction: { type: 'stay' }
      }
    }
  }

  #swagger.responses[400] = {
    description: 'Failed to update privacy settings',
    schema: { success: false, message: 'Failed to update privacy settings' }
  }

  #swagger.responses[401] = {
    description: 'Unauthorized user',
    schema: { success: false, message: 'Unauthorized user' }
  }

  #swagger.responses[500] = {
    description: 'Server error',
    schema: { success: false, message: 'Unable to save privacy settings', error: 'Internal server error' }
  }
*/ save_privacy_setting);

router.get("/web_setting", authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Retrieve web configuration and user details'
  #swagger.description = 'Load web configuration settings along with user role, priority, and token.'

  #swagger.security = [{
    bearerAuth: []
  }]

  #swagger.parameters['Authorization'] = {
    in: 'header',
    description: 'JWT token (format: Bearer <token>)',
    required: true,
    schema: { type: 'string' },
    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }

  #swagger.responses[200] = {
    description: 'Web settings loaded successfully',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Web settings loaded successfully' },
            data: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Dr. Alice Chen' },
                role: { type: 'string', example: 'admin' },
                priority: { type: 'number', example: 1 },
                config: {
                  type: 'object',
                  example: {
                    siteTitle: 'Oral Cancer Management Platform',
                    logoUrl: '/images/logo.png',
                    enableChatbot: true,
                    maintenanceMode: false
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
    description: 'Unauthorized or missing token',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Missing or invalid token' }
          }
        }
      }
    }
  }

  #swagger.responses[500] = {
    description: 'Failed to load web settings',
    content: {
      "application/json": {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Failed to load web settings' },
            error: { type: 'string', example: 'Internal server error' }
          }
        }
      }
    }
  }
*/ web_setting);

router.get("/guideline", authenticateToken, 
/* 
  #swagger.tags = ['System']
  #swagger.summary = 'Load system usage guideline'
  #swagger.description = 'Returns user basic profile (name, role) extracted from JWT token.'
  
  #swagger.security = [{
    bearerAuth: []
  }]

  #swagger.parameters['Authorization'] = {
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'JWT Token in Bearer format',
    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }

  #swagger.responses[200] = {
    description: 'Guideline loaded successfully',
    schema: {
      success: true,
      message: 'Guideline loaded',
      data: {
        name: 'Dr. Alice Chen',
        role: 'doctor',
        token: 'eyJhbGciOiJIUzI1NiIsInR...'
      }
    }
  }

  #swagger.responses[401] = {
    description: 'Unauthorized or missing token',
    schema: {
      success: false,
      message: 'Unauthorized or missing token'
    }
  }

  #swagger.responses[500] = {
    description: 'Failed to load guideline',
    schema: {
      success: false,
      message: 'Failed to load guideline',
      error: 'Internal server error'
    }
  }
*/ guideline);

router.get("/education", authenticateToken, 
/* 
  #swagger.tags = ['System']
  #swagger.summary = 'Load education and learning resources'
  #swagger.description = 'Returns authenticated user data and grants access to educational content.'

  #swagger.security = [{
    bearerAuth: []
  }]

  #swagger.parameters['Authorization'] = {
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'JWT Bearer Token',
    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }

  #swagger.responses[200] = {
    description: 'Education content loaded successfully',
    schema: {
      success: true,
      message: 'Education content loaded',
      data: {
        name: 'Dr. Alice Chen',
        role: 'doctor',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      }
    }
  }

  #swagger.responses[401] = {
    description: 'Unauthorized or missing token',
    schema: {
      success: false,
      message: 'Unauthorized or missing token'
    }
  }

  #swagger.responses[500] = {
    description: 'Failed to load education',
    schema: {
      success: false,
      message: 'Failed to load education',
      error: 'Internal server error'
    }
  }
*/ education);

router.post("/sys_import", authenticateToken, 
    /*
  #swagger.tags = ['System']
  #swagger.summary = 'Import system configuration file'
  #swagger.description = 'Upload and apply system configuration via JSON file. Must use multipart/form-data with a config file.'

  #swagger.consumes = ['multipart/form-data']

  #swagger.security = [{
    bearerAuth: []
  }]

  #swagger.parameters['file'] = {
    in: 'formData',
    required: true,
    type: 'file',
    description: 'JSON configuration file'
  }

  #swagger.parameters['token'] = {
    in: 'formData',
    required: true,
    type: 'string',
    example: 'eyJhbGciOiJIUzI1Ni...',
    description: 'JWT token for authentication'
  }

  #swagger.responses[200] = {
    description: 'Configuration imported successfully',
    schema: {
      success: true,
      message: 'Configuration imported successfully',
      data: {
        updated_at: '2025-01-22T10:21:54.111Z',
        nextAction: { type: 'navigate', path: '/api/auth/web_setting' }
      }
    }
  }

  #swagger.responses[400] = {
    description: 'Invalid file or JSON format',
    schema: {
      success: false,
      message: 'Invalid JSON format'
    }
  }

  #swagger.responses[401] = {
    description: 'Unauthorized or missing token',
    schema: { success: false, message: 'Missing token' }
  }

  #swagger.responses[500] = {
    description: 'System import failed',
    schema: { success: false, message: 'System import failed', error: 'Internal server error' }
  }
*/ sys_import);

router.post("/sys_export", authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Export system configuration file'
  #swagger.description = 'Exports the current system configuration as a downloadable JSON file.'
  #swagger.security = [{ bearerAuth: [] }]

  #swagger.responses[200] = {
      description: 'Configuration JSON file will be downloaded',
      content: {
        "application/octet-stream": {
          schema: { type: 'string', format: 'binary' }
        }
      }
  }

  #swagger.responses[500] = {
    description: 'Failed to export configuration',
    schema: {
      success: false,
      message: 'Export failed',
      error: 'Error message detail'
    }
  }
*/ sys_export);

router.post("/reset", upload.none(), authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Reset system configuration to default'
  #swagger.description = 'Restores system configurations back to default_config.json. Requires valid authentication token.'

  #swagger.security = [{
    bearerAuth: []
  }]

  #swagger.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', example: 'eyJh...' }
          }
        }
      }
    }
  }

  #swagger.responses[201] = {
    description: 'System reset successfully',
    schema: {
      success: true,
      message: 'System reset successfully',
      data: { redirect: '/api/auth/web_setting?token=eyJh...' }
    }
  }

  #swagger.responses[400] = {
    description: 'Missing or invalid token',
    schema: { success: false, message: 'Missing token' }
  }

  #swagger.responses[500] = {
    description: 'Server error occurred during reset',
    schema: { success: false, message: 'Reset failed', error: 'Internal server error' }
  }
*/ reset);

router.post("/apply_system_setting", authenticateToken, 
/*
  #swagger.tags = ['System']
  #swagger.summary = 'Apply system settings (save/reset/backup/recover)'
  #swagger.description = 'Allows saving, resetting, exporting (backup), or recovering system settings.'
  #swagger.security = [{ bearerAuth: [] }]

  #swagger.parameters['body'] = {
    in: 'body',
    required: true,
    schema: {
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      action: 'save',
      siteTitle: 'Oral Cancer Web App',
      logoUrl: '/images/logo.png',
      enableChatbot: true
    }
  }

  #swagger.responses[200] = {
    description: 'System setting applied successfully (save/reset/recover)',
    schema: {
      success: true,
      message: 'System setting applied',
      data: {
        redirect: '/api/auth/web_setting?token=eyJhb...'
      }
    }
  }

  #swagger.responses[207] = {
    description: 'Backup file downloaded',
    content: {
      "application/octet-stream": {
        schema: { type: 'string', format: 'binary' }
      }
    }
  }

  #swagger.responses[400] = {
    description: 'Invalid action or missing fields',
    schema: { success: false, message: 'Invalid action' }
  }

  #swagger.responses[404] = {
    description: 'No config file found',
    schema: { success: false, message: 'No config file found' }
  }

  #swagger.responses[500] = {
    description: 'Internal server error',
    schema: { success: false, message: 'Failed to apply system settings' }
  }
*/ apply_system_setting);

export default router;