-- AlterTable: Add org hierarchy fields to services
ALTER TABLE "services" ADD COLUMN "team" TEXT;
ALTER TABLE "services" ADD COLUMN "center_2_name" TEXT;
ALTER TABLE "services" ADD COLUMN "center_1_name" TEXT;

-- AlterTable: Add enDeptName and departmentCode to users
ALTER TABLE "users" ADD COLUMN "en_dept_name" TEXT;
ALTER TABLE "users" ADD COLUMN "department_code" TEXT;

-- CreateTable: Department hierarchy cache
CREATE TABLE "department_hierarchies" (
    "id" TEXT NOT NULL,
    "department_code" TEXT NOT NULL,
    "department_name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "center_2_name" TEXT NOT NULL,
    "center_1_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_hierarchies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_hierarchies_department_code_key" ON "department_hierarchies"("department_code");
