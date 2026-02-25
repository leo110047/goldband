# Schema Design Reference

Detailed reference for database schema design including normalization forms, common patterns, and naming conventions.

## Normalization Forms

### First Normal Form (1NF)

**Rule:** Each column contains atomic (indivisible) values. No repeating groups or arrays in a single column.

```sql
-- Violates 1NF: multiple values in one column
CREATE TABLE orders_bad (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(100),
  products VARCHAR(500)  -- "Widget, Gadget, Sprocket"
);

-- 1NF: separate table for the multi-valued attribute
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(100)
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_name VARCHAR(100),
  quantity INT NOT NULL DEFAULT 1
);
```

**Exception:** PostgreSQL arrays and JSONB columns are acceptable when:
- The data is truly a list of simple values (tags, labels)
- You do not need to JOIN or filter on individual elements frequently
- You use GIN indexes for containment queries

### Second Normal Form (2NF)

**Rule:** In 1NF, plus every non-key column depends on the entire primary key (not just part of a composite key).

```sql
-- Violates 2NF: student_name depends only on student_id, not on (student_id, course_id)
CREATE TABLE enrollments_bad (
  student_id INT,
  course_id INT,
  student_name VARCHAR(100),   -- depends only on student_id
  grade CHAR(2),
  PRIMARY KEY (student_id, course_id)
);

-- 2NF: separate the partial dependency
CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE enrollments (
  student_id INT REFERENCES students(id),
  course_id INT REFERENCES courses(id),
  grade CHAR(2),
  PRIMARY KEY (student_id, course_id)
);
```

### Third Normal Form (3NF)

**Rule:** In 2NF, plus no non-key column depends on another non-key column (no transitive dependencies).

```sql
-- Violates 3NF: city and state depend on zip_code, not on the primary key directly
CREATE TABLE customers_bad (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  zip_code VARCHAR(10),
  city VARCHAR(100),     -- depends on zip_code
  state VARCHAR(50)      -- depends on zip_code
);

-- 3NF: extract the transitive dependency
CREATE TABLE zip_codes (
  code VARCHAR(10) PRIMARY KEY,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50) NOT NULL
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  zip_code VARCHAR(10) REFERENCES zip_codes(code)
);
```

### Practical Guidance

In practice, most applications should target 3NF for their core transactional tables. Going beyond 3NF (BCNF, 4NF, 5NF) is rarely necessary and adds complexity. Denormalize deliberately from 3NF when you have proven read performance needs.

---

## Common Schema Patterns

### Polymorphic Associations

When multiple entity types share a relationship to another entity.

**Approach 1: Shared foreign key with type discriminator**

```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  commentable_type VARCHAR(50) NOT NULL,  -- 'post', 'photo', 'video'
  commentable_id INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Downside: no foreign key constraint (commentable_id could point to nothing)
-- Mitigation: application-level validation or triggers
CREATE INDEX idx_comments_target ON comments (commentable_type, commentable_id);
```

**Approach 2: Separate foreign keys (preferred for referential integrity)**

```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  post_id INT REFERENCES posts(id),
  photo_id INT REFERENCES photos(id),
  video_id INT REFERENCES videos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure exactly one FK is set
  CONSTRAINT one_parent CHECK (
    (post_id IS NOT NULL)::INT +
    (photo_id IS NOT NULL)::INT +
    (video_id IS NOT NULL)::INT = 1
  )
);
```

**Approach 3: Intermediate join tables**

```sql
CREATE TABLE post_comments (
  comment_id INT REFERENCES comments(id) PRIMARY KEY,
  post_id INT REFERENCES posts(id) NOT NULL
);

CREATE TABLE photo_comments (
  comment_id INT REFERENCES comments(id) PRIMARY KEY,
  photo_id INT REFERENCES photos(id) NOT NULL
);
```

### Self-Referencing (Hierarchical Data)

**Adjacency List (simple parent reference):**

```sql
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INT REFERENCES categories(id),
  depth INT NOT NULL DEFAULT 0
);

-- Fetch immediate children
SELECT * FROM categories WHERE parent_id = 5;

-- Fetch full tree (recursive CTE)
WITH RECURSIVE tree AS (
  SELECT id, name, parent_id, depth, ARRAY[id] AS path
  FROM categories
  WHERE parent_id IS NULL

  UNION ALL

  SELECT c.id, c.name, c.parent_id, c.depth, tree.path || c.id
  FROM categories c
  JOIN tree ON c.parent_id = tree.id
)
SELECT * FROM tree ORDER BY path;
```

**Materialized Path (store full path as string):**

```sql
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  path LTREE NOT NULL  -- requires ltree extension: '1.5.12'
);

CREATE INDEX idx_categories_path ON categories USING GIST (path);

-- Fetch all descendants of node 5
SELECT * FROM categories WHERE path <@ '1.5';

-- Fetch all ancestors of node 12
SELECT * FROM categories WHERE '1.5.12' <@ path;
```

**Trade-offs:**

| Approach | Read Speed | Write Speed | Integrity | Best For |
|----------|-----------|-------------|-----------|----------|
| Adjacency List | Slow (recursive) | Fast | Strong (FK) | Small trees, frequent writes |
| Materialized Path | Fast (pattern match) | Slow (update paths on move) | Weak | Deep trees, rare restructuring |
| Nested Sets | Fast (range query) | Very slow (rebalance) | Weak | Read-heavy, stable hierarchies |
| Closure Table | Fast (pre-computed) | Medium (maintain closure) | Strong | Balanced read/write |

### Audit Trail Pattern

```sql
-- Option 1: Audit columns on every table
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  -- Audit columns
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INT REFERENCES users(id)
);

-- Auto-update updated_at with trigger
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Option 2: Separate audit log table (full history)
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id INT NOT NULL,
  action VARCHAR(10) NOT NULL,  -- INSERT, UPDATE, DELETE
  old_data JSONB,
  new_data JSONB,
  changed_by INT REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table_record ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_changed_at ON audit_log (changed_at);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    current_setting('app.current_user_id', true)::INT
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply to any table
CREATE TRIGGER orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

### Soft Delete Pattern

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  deleted_at TIMESTAMPTZ,  -- NULL means active
  -- Unique constraint only on active records
  CONSTRAINT unique_active_email UNIQUE (email) WHERE (deleted_at IS NULL)
);

-- Partial index: queries on active records use this small index
CREATE INDEX idx_users_active ON users (email) WHERE deleted_at IS NULL;

-- "Delete" a user
UPDATE users SET deleted_at = NOW() WHERE id = 42;

-- Query active users (always filter)
SELECT * FROM users WHERE deleted_at IS NULL;

-- View for convenience
CREATE VIEW active_users AS
  SELECT * FROM users WHERE deleted_at IS NULL;
```

---

## Naming Conventions

### Tables

| Convention | Example | Notes |
|-----------|---------|-------|
| Plural, snake_case | `order_items` | Most common in PostgreSQL / Rails |
| Singular, PascalCase | `OrderItem` | Common in SQL Server / EF Core |

Pick one convention and stick with it across the entire database.

### Columns

```
Primary key:       id (or table_id for clarity: user_id)
Foreign key:       referenced_table_id (e.g., user_id, order_id)
Boolean:           is_active, has_verified, can_edit (prefix with is/has/can)
Timestamps:        created_at, updated_at, deleted_at, expires_at
Status/enum:       status, role, type (keep generic, document valid values)
Counts:            order_count, login_count (suffix with _count)
Amounts:           total_amount, discount_amount (suffix with _amount)
```

### Indexes

```
Pattern:  idx_{table}_{column(s)}_{type}
Examples:
  idx_users_email              -- single column
  idx_orders_status_created_at -- composite
  idx_orders_pending           -- partial (where status = 'pending')
  idx_products_name_gin        -- specifying index type
```

### Constraints

```
Pattern:  {table}_{type}_{column(s)}
Examples:
  users_pk                     -- primary key
  users_email_unique           -- unique constraint
  orders_user_id_fk            -- foreign key
  orders_total_check           -- check constraint
```

---

## Data Types Best Practices

| Use Case | Recommended Type | Avoid |
|----------|-----------------|-------|
| Primary key | `BIGSERIAL` or `UUID` | `SERIAL` (32-bit overflow risk at scale) |
| Money | `DECIMAL(precision, scale)` or `BIGINT` (cents) | `FLOAT` / `DOUBLE` (rounding errors) |
| Timestamps | `TIMESTAMPTZ` | `TIMESTAMP` without timezone |
| Short strings | `VARCHAR(n)` with explicit limit | `TEXT` with no length validation |
| Long text | `TEXT` | `VARCHAR(10000)` (no performance difference, misleading limit) |
| Enum values | `VARCHAR` with CHECK constraint or PostgreSQL `ENUM` | Magic integers |
| IP addresses | `INET` | `VARCHAR` |
| JSON data | `JSONB` | `JSON` (no indexing, slower operations) |
| Booleans | `BOOLEAN` | `INT` (0/1) or `CHAR(1)` (Y/N) |
