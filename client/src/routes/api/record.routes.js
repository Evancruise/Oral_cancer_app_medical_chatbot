import express from "express";
import multer from "multer";
import { 
  record,
  temp_upload,
  new_record,
  edit_record,
  analyze,
  get_inference_status,
  record_search,
  export_data,
  recycle_bin,
  recycle_record
} from "#controllers/api/record.controller.js";
import { authenticateToken } from "#src/middleware/users.middleware.js";

const router = express.Router();

router.get("/record", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Retrieve grouped medical records by date'
    #swagger.description = 'Returns all user records grouped by date (YYYY-MM-DD) and sorted from newest to oldest.'
    #swagger.security = [{ bearerAuth: [] }]
  
    #swagger.parameters['token'] = {
      in: 'query',
      required: false,
      description: 'JWT authentication token (⚠ 建議使用 Authorization header)',
      schema: { type: 'string' }
    }
  
    #swagger.responses[200] = {
      description: 'Records retrieved successfully',
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Records retrieved' },
              data: {
                type: 'object',
                properties: {
                  totalGroups: { type: 'number', example: 3 },
                  records: {
                    type: 'object',
                    example: {
                      "2025-02-15": [
                        {
                          id: "rec_123",
                          patient_id: "pat_001",
                          created_at: "2025-02-15T08:30:00.000Z",
                          diagnosis: "Lesion observed"
                        }
                      ],
                      "2025-02-10": [
                        {
                          id: "rec_122",
                          patient_id: "pat_002",
                          created_at: "2025-02-10T14:20:00.000Z",
                          diagnosis: "Normal"
                        }
                      ]
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
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Unauthorized or missing token' }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to retrieve records',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Failed to retrieve records' },
            error: { type: 'string', example: 'Internal server error' }
          }
        }
      }
    }
  */
  record
);

router.post("/new_record", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Create new medical record'
    #swagger.description = 'Upload images and create a new medical record. Supports create, infer, or check_result actions.'
    #swagger.security = [{ bearerAuth: [] }]
  
    #swagger.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["patient_id", "action"],
            properties: {
              patient_id: { type: "string", example: "P12345" },
              action: { type: "string", enum: ["create", "infer", "check_result"], example: "create" },
              pic1_2: { type: "string", format: "binary" },
              pic2_2: { type: "string", format: "binary" },
              pic3_2: { type: "string", format: "binary" },
              pic4_2: { type: "string", format: "binary" },
              pic5_2: { type: "string", format: "binary" },
              pic6_2: { type: "string", format: "binary" },
              pic7_2: { type: "string", format: "binary" },
              pic8_2: { type: "string", format: "binary" }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Record created or inference started successfully',
      content: {
        "application/json": {
          schema: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Record created successfully" },
            data: {
              type: "object",
              properties: {
                patient_id: { type: "string", example: "P12345" },
                action: { type: "string", example: "create" }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Invalid request or missing parameters',
      content: {
        "application/json": {
          schema: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Please upload all required images" }
          }
        }
      }
    }
  
    #swagger.responses[401] = {
      description: 'Unauthorized user',
      content: {
        "application/json": {
          schema: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Unauthorized user_id" }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Server error',
      content: {
        "application/json": {
          schema: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Error creating record" },
            error: { type: "string", example: "Internal server error" }
          }
        }
      }
    }
  */
  new_record
);

router.post("/edit_record", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Edit, delete or re-trigger inference for medical record'
    #swagger.description = 'Allow users to update image files, move record to recycle bin, or trigger inference.'
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["patient_id", "action"],
            properties: {
              patient_id: { type: "string", example: "P12345" },
              action: { type: "string", enum: ["save", "delete", "infer"], example: "save" },
              pic1_2: { type: "string", format: "binary" },
              pic2_2: { type: "string", format: "binary" },
              pic3_2: { type: "string", format: "binary" },
              pic4_2: { type: "string", format: "binary" },
              pic5_2: { type: "string", format: "binary" },
              pic6_2: { type: "string", format: "binary" },
              pic7_2: { type: "string", format: "binary" },
              pic8_2: { type: "string", format: "binary" }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Record updated or deleted successfully',
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Record updated successfully' },
              data: {
                type: 'object',
                properties: {
                  patient_id: { type: 'string', example: 'P12345' },
                  action: { type: 'string', example: 'save' }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Invalid request or missing fields',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Missing patient_id' }
          }
        }
      }
    }
  
    #swagger.responses[401] = {
      description: 'Unauthorized or invalid token',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Unauthorized' }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Server error occurred',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error updating record' },
            error: { type: 'string', example: 'Unexpected error occurred' }
          }
        }
      }
    }
  */
  edit_record
);

router.post("/analyze", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Perform AI model inference'
    #swagger.description = 'Uploads up to 8 medical images for AI inference and returns a task_id used for tracking status.'
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              token: { type: "string", example: "eyJhbGciOi..." },
              patient_id: { type: "string", example: "P12345" },
              notes: { type: "string", example: "Detected possible lesion" },
              pic1: { type: "string", format: "binary" },
              pic2: { type: "string", format: "binary" },
              pic3: { type: "string", format: "binary" },
              pic4: { type: "string", format: "binary" },
              pic5: { type: "string", format: "binary" },
              pic6: { type: "string", format: "binary" },
              pic7: { type: "string", format: "binary" },
              pic8: { type: "string", format: "binary" }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Inference successfully started',
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Inference started' },
              data: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', example: 'task_123456789' },
                  patient_id: { type: 'string', example: 'P12345' },
                  nextAction: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', example: 'navigate' },
                      path: { type: 'string', example: '/api/auth/get_inference_status/task_123456789' }
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
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Missing patient_id' }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Server or AI service error',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Failed to start inference' },
            error: { type: 'string', example: 'Connection timeout to Flask AI service' }
          }
        }
      }
    }
  */
  analyze
);

router.get("/get_inference_status/:task_id", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Get AI inference task status'
    #swagger.description = 'Retrieve real-time AI inference status for a given task_id from Flask inference service.'
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.parameters['task_id'] = {
      in: 'path',
      description: 'Unique AI inference task ID',
      required: true,
      schema: { type: 'string' },
      example: 'inference_abc_20250208'
    }
  
    #swagger.responses[200] = {
      description: 'Inference status retrieved successfully',
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Inference status retrieved' },
              data: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', example: 'inference_abc_20250208' },
                  status: { type: 'string', example: 'completed' },
                  progress: { type: 'number', example: 100 },
                  message: { type: 'string', example: 'Inference completed successfully' },
                  completed_at: { type: 'string', example: '2025-02-08T15:30:00.000Z' }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Missing or invalid task_id parameter',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Missing task_id parameter' }
          }
        }
      }
    }
  
    #swagger.responses[404] = {
      description: 'Task not found',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Failed to fetch inference status (HTTP 404)' }
          }
        }
      }
    }
  
    #swagger.responses[500] = {
      description: 'Internal server error while fetching inference status',
      content: {
        "application/json": {
          schema: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Unable to get inference status' },
            error: { type: 'string', example: 'Connection timeout or server error' }
          }
        }
      }
    }
  */
  get_inference_status
);

router.get("/record_search", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Search and retrieve all records grouped by date'
    #swagger.description = 'Retrieves all records, sorts by creation date, groups by YYYY-MM-DD, includes metadata.'
  
    #swagger.parameters['token'] = {
      in: 'query',
      required: false,
      description: 'JWT authentication token (建議使用 Authorization header)',
      schema: { type: 'string' },
      example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    }
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.responses[200] = {
      description: 'Records successfully retrieved and grouped',
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Record search results' },
              data: {
                type: 'object',
                properties: {
                  grouped_records: {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: { type: 'object' }
                    }
                  },
                  total: { type: 'number', example: 5 },
                  today_date: { type: 'string', example: '2025-02-18' }
                }
              }
            }
          }
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
      description: 'Failed to search records',
      schema: {
        success: false,
        message: 'Failed to search records',
        error: 'Internal server error'
      }
    }
  */
  record_search
);

router.post("/export_data", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Export medical records to Excel file'
    #swagger.description = 'Accepts JSON array of record objects and returns an auto-generated Excel (.xlsx) file for download.'
  
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              tableData: {
                type: 'array',
                description: 'List of record objects for export',
                items: {
                  type: 'object',
                  properties: {
                    patient_id: { type: 'string', example: 'PAT001' },
                    created_at: { type: 'string', example: '2025-02-01' },
                    updated_at: { type: 'string', example: '2025-02-10' },
                    name: { type: 'string', example: 'Dr. Chen' },
                    status: { type: 'string', example: 'Completed' },
                    notes: { type: 'string', example: 'Lesion found' }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Excel file generated successfully',
      content: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
          schema: {
            type: 'string',
            format: 'binary'
          }
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'No data provided for export',
      schema: {
        success: false,
        message: 'No data to export'
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to generate Excel file',
      schema: {
        success: false,
        message: 'Export data failed',
        error: 'Error details here'
      }
    }
  */
  export_data
);

router.get("/recycle_bin", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Retrieve discarded records'
    #swagger.description = 'Get all discarded (deleted) records grouped by date (YYYY-MM-DD), newest first.'
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.responses[200] = {
      description: 'Discarded records successfully retrieved',
      schema: {
        success: true,
        message: "Discarded records retrieved",
        data: {
          totalGroups: 2,
          records: {
            "2025-01-10": [
              {
                record_id: "R102",
                patient_id: "P3892",
                created_at: "2025-01-10T08:21:45.611Z",
                status: "discarded",
                reason: "Duplicate upload",
                updated_at: "2025-01-10T09:21:45.611Z"
              }
            ],
            "2025-01-08": [
              {
                record_id: "R087",
                patient_id: "P1022",
                created_at: "2025-01-08T04:11:22.111Z",
                status: "discarded",
                reason: "User requested deletion",
                updated_at: "2025-01-08T05:00:11.111Z"
              }
            ]
          }
        }
      }
    }
  
    #swagger.responses[401] = {
      description: 'Unauthorized or missing token',
      schema: {
        success: false,
        message: "Unauthorized or missing token"
      }
    }
  
    #swagger.responses[500] = {
      description: 'Failed to retrieve discarded records',
      schema: {
        success: false,
        message: "Failed to retrieve discarded records",
        error: "Error details here"
      }
    }
  */
  recycle_bin
);

router.post("/recycle_record", authenticateToken,
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Restore or delete discarded record'
    #swagger.description = 'Used to restore a record from recycle bin or permanently delete it.'
  
    #swagger.security = [{
      "bearerAuth": []
    }]
  
    #swagger.consumes = ['multipart/form-data']
    #swagger.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: { 
            type: "object",
            required: ["action", "patient_id"],
            properties: {
              record_id: {
                type: "string",
                example: "10",
                description: "Record ID (optional for resume)"
              },
              patient_id: {
                type: "string",
                example: "P12345",
                description: "Patient identifier"
              },
              action: {
                type: "string",
                enum: ["resume", "delete"],
                example: "resume",
                description: "Which action to apply"
              }
            }
          }
        }
      }
    }
  
    #swagger.responses[200] = {
      description: 'Record action completed successfully',
      schema: {
        success: true,
        message: "Files restored successfully",
        data: {
          patient_id: "P12345",
          action: "resume"
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'Invalid request parameters',
      schema: {
        success: false,
        message: "Missing required fields: action, patient_id"
      }
    }
  
    #swagger.responses[500] = {
      description: 'Internal server error',
      schema: {
        success: false,
        message: "Internal server error",
        error: "Error details..."
      }
    }
  */
  recycle_record
);

router.post("/temp_upload", 
  /*
    #swagger.tags = ['Record']
    #swagger.summary = 'Temporary upload image/file for record'
    #swagger.description = 'Uploads a file (local or to GCS based on environment) and returns the stored file URL.'
  
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = {
      in: 'formData',
      type: 'file',
      required: true,
      description: 'File to be uploaded'
    }
  
    #swagger.parameters['patient_id'] = {
      in: 'formData',
      required: true,
      type: 'string',
      description: 'Patient unique ID',
      example: 'A12345'
    }
  
    #swagger.parameters['code'] = {
      in: 'formData',
      required: false,
      type: 'string',
      description: 'Optional image code (default: x)',
      example: '1'
    }
  
    #swagger.responses[200] = {
      description: 'File uploaded successfully',
      schema: {
        success: true,
        message: 'File uploaded',
        data: {
          url: 'tmp/public/uploads/A12345/A12345_1_image.jpg',
          env: 'development'
        }
      }
    }
  
    #swagger.responses[400] = {
      description: 'No file uploaded',
      schema: {
        success: false,
        message: 'No file uploaded'
      }
    }
  
    #swagger.responses[500] = {
      description: 'Upload failed (server or GCS issue)',
      schema: {
        success: false,
        message: 'Upload failed',
        error: 'Error details here'
      }
    }
  */
  temp_upload
);

export default router;