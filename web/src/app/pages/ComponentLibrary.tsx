import { useState } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton, TableSkeleton, CardSkeleton } from "../components/ui/Skeleton";
import { Plus, Settings, Inbox, CheckCircle, AlertCircle, Info } from "lucide-react";

export function ComponentLibrary() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1>Component Library</h1>
        <p className="text-muted-foreground">
          Reusable UI components and design system documentation
        </p>
      </div>

      <section className="space-y-4">
        <h2>Buttons</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <h4 className="mb-3">Variants</h4>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary">Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                </div>
              </div>

              <div>
                <h4 className="mb-3">Sizes</h4>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                </div>
              </div>

              <div>
                <h4 className="mb-3">With Icons</h4>
                <div className="flex flex-wrap gap-3">
                  <Button>
                    <Plus className="w-4 h-4" />
                    Add Item
                  </Button>
                  <Button variant="outline">
                    <Settings className="w-4 h-4" />
                    Settings
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="mb-3">States</h4>
                <div className="flex flex-wrap gap-3">
                  <Button disabled>Disabled</Button>
                  <Button variant="outline" disabled>
                    Disabled Outline
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Form Inputs</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input label="Text Input" placeholder="Enter text..." />
              <Input label="Required Field" placeholder="Required" required />
              <Input label="Email Input" type="email" placeholder="you@example.com" />
              <Input label="With Error" error="This field is required" />
              <Input label="With Helper" helperText="Enter your full name" />
              <Input label="Date Input" type="date" />
              <Select
                label="Select Dropdown"
                options={[
                  { value: "", label: "Select option..." },
                  { value: "1", label: "Option 1" },
                  { value: "2", label: "Option 2" },
                  { value: "3", label: "Option 3" },
                ]}
              />
              <Select
                label="Required Select"
                required
                options={[
                  { value: "", label: "Select..." },
                  { value: "a", label: "Choice A" },
                  { value: "b", label: "Choice B" },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Badges</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="info">Info</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Card</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This is a basic card with header and content.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h4 className="mb-2">No Header Card</h4>
              <p className="text-muted-foreground">
                A card without a header section.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>With Action</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">Card with button.</p>
              <Button size="sm">Action</Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Table</h2>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Item 1</TableCell>
                  <TableCell>
                    <Badge variant="success">Active</Badge>
                  </TableCell>
                  <TableCell>$1,200</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Item 2</TableCell>
                  <TableCell>
                    <Badge variant="warning">Pending</Badge>
                  </TableCell>
                  <TableCell>$800</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Item 3</TableCell>
                  <TableCell>
                    <Badge variant="info">Processing</Badge>
                  </TableCell>
                  <TableCell>$2,100</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Tabs</h2>
        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="tab1">
              <TabsList>
                <TabsTrigger value="tab1">First Tab</TabsTrigger>
                <TabsTrigger value="tab2">Second Tab</TabsTrigger>
                <TabsTrigger value="tab3">Third Tab</TabsTrigger>
              </TabsList>
              <TabsContent value="tab1">
                <p className="text-muted-foreground">Content for the first tab.</p>
              </TabsContent>
              <TabsContent value="tab2">
                <p className="text-muted-foreground">Content for the second tab.</p>
              </TabsContent>
              <TabsContent value="tab3">
                <p className="text-muted-foreground">Content for the third tab.</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Breadcrumbs</h2>
        <Card>
          <CardContent className="pt-6">
            <Breadcrumbs
              items={[
                { label: "Home", href: "/app" },
                { label: "Opportunities", href: "/app/opportunities" },
                { label: "Detail" },
              ]}
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Modal</h2>
        <Card>
          <CardContent className="pt-6">
            <Button onClick={() => setIsModalOpen(true)}>Open Modal</Button>
            <Modal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              title="Example Modal"
              footer={
                <>
                  <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setIsModalOpen(false)}>Confirm</Button>
                </>
              }
            >
              <p className="text-muted-foreground">
                This is a modal dialog with a header, content area, and footer actions.
              </p>
            </Modal>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Empty State</h2>
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Inbox}
              title="No items found"
              description="Get started by creating your first item."
              actionLabel="Create Item"
              onAction={() => alert("Action clicked")}
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2>Skeleton Loaders</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Card Skeleton</CardTitle>
            </CardHeader>
            <CardContent>
              <CardSkeleton />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Table Skeleton</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton rows={3} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Design Tokens</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Colors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-primary"></div>
                  <div>
                    <p>Primary</p>
                    <p className="text-sm text-muted-foreground">var(--primary)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-secondary"></div>
                  <div>
                    <p>Secondary</p>
                    <p className="text-sm text-muted-foreground">var(--secondary)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-destructive"></div>
                  <div>
                    <p>Destructive</p>
                    <p className="text-sm text-muted-foreground">var(--destructive)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-muted"></div>
                  <div>
                    <p>Muted</p>
                    <p className="text-sm text-muted-foreground">var(--muted)</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Spacing & Radius</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <p className="mb-2">Border Radius</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary rounded-sm"></div>
                    <div className="w-8 h-8 bg-primary rounded-md"></div>
                    <div className="w-8 h-8 bg-primary rounded-lg"></div>
                    <div className="w-8 h-8 bg-primary rounded-xl"></div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">sm, md, lg, xl</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Icons (Lucide React)</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col items-center gap-2">
                <CheckCircle className="w-6 h-6" />
                <p className="text-sm">CheckCircle</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <AlertCircle className="w-6 h-6" />
                <p className="text-sm">AlertCircle</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Info className="w-6 h-6" />
                <p className="text-sm">Info</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Plus className="w-6 h-6" />
                <p className="text-sm">Plus</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Settings className="w-6 h-6" />
                <p className="text-sm">Settings</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
