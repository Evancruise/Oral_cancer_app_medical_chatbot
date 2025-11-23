import { successResponse, errorResponse } from "#utils/responses.js";
import { createAppointment, deleteAppoint, getAppointment, updateAppointment, updateAppointmentStatus } from "#src/services/appointment.service.js";

export const appointments = async (req, res) => {
  try {
    const user = req.user; // Authorization Header 驗證後的資料

    const appointments = await getAppointment("name", user.name);
    let grouped = {};

    if (appointments && Array.isArray(appointments)) {
      appointments.sort((a, b) => new Date(b.date) - new Date(a.date));
      grouped = appointments.reduce((acc, item) => {
        const dateKey = new Date(item.date).toISOString().split("T")[0];
        (acc[dateKey] = acc[dateKey] || []).push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Appointments retrieved successfully", {
      user: { name: user.name, email: user.email },
      totalGroups: Object.keys(grouped).length,
      grouped_appointments: grouped
    });
  } catch (err) {
    return errorResponse(res, "Failed to retrieve appointments", err.message, 500);
  }
};

export const update_appointment = async (req, res) => {
  try {
    const { action } = req.body;
    const user = req.user; 

    if (!action) {
      return errorResponse(res, "Missing action", {}, 400);
    }

    if (action === "create") {
      const newAppointment = await createAppointment(req.body);
      return successResponse(res, "Appointment created successfully", {
        appointment: newAppointment
      });
    }

    if (action === "edit") {
      const updated = await updateAppointment(req.body);
      return successResponse(res, "Appointment updated successfully", {
        appointment: updated
      });
    }

    if (action === "delete") {
      await deleteAppoint(req.body);
      return successResponse(res, "Appointment deleted successfully");
    }

    return errorResponse(res, "Invalid action", {}, 400);

  } catch (err) {
    return errorResponse(res, "Error updating appointment", err.message, 500);
  }
};

export const update_appointment_status = async (req, res) => {
  try {
    const { action, date } = req.body;
    const user = req.user;

    if (!action || !date) {
      return errorResponse(res, "Missing fields: action or date", {}, 400);
    }

    if (action === "confirm") {
      await updateAppointmentStatus(user.name, date, "checkin", "true");
      return successResponse(res, "Appointment confirmed");
    }

    if (action === "cancel") {
      await updateAppointmentStatus(user.name, date, "checkin", "false");
      return successResponse(res, "Appointment canceled");
    }

    return errorResponse(res, "Invalid action", {}, 400);

  } catch (err) {
    return errorResponse(res, "Error updating appointment status", err.message, 500);
  }
};