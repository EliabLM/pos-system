'use server'

import { prisma } from "@/lib/db";

export const getOrganizations = async () => {
    try {
        const result = prisma.organization.findMany()
        return result
    } catch (error) {
        console.error("🚀 ~ getOrganizations ~ error:", error)
        return "ERROR"
    }
}