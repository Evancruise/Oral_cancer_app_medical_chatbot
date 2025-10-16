import { z } from "zod";

/*
Validate userId params
*/
export const userIdSchema = z
  .object({
    id: z
      .string()
      .regex(/^\d+$/, "id must be a number")
  }); // ✅ 允許其他 key 存在

/*
Validate idUser params
*/
export const nameUserSchema = z
  .object({
    name: z.string().min(2).max(100)
  }); // ✅ 允許其他 key 存在

/*
Validate update user body
*/
export const updateUserSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    email: z.email().max(255).toLowerCase().trim().optional(),
    role: z.enum(["user", "admin"]).optional(),
    password: z.string().min(6).optional(),
});