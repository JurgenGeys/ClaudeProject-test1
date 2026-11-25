import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Checkbox } from "./checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";

// Smoke tests: the components are copied from shadcn/ui, so these only check that they
// render and keep the accessible behavior the screens rely on.
describe("shadcn/ui components", () => {
  it("links a Label to an Input and a Textarea", () => {
    render(
      <>
        <Label htmlFor="a">Naam</Label>
        <Input id="a" />
        <Label htmlFor="b">Instructies</Label>
        <Textarea id="b" />
      </>,
    );
    expect(screen.getByLabelText("Naam")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("Instructies")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("renders a Button as a button, or as a link with asChild", () => {
    render(
      <>
        <Button>Bewaren</Button>
        <Button asChild>
          <a href="/tasks">Naar taken</a>
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Bewaren" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar taken" })).toHaveAttribute("href", "/tasks");
  });

  it("renders an Alert with the alert role", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Fout</AlertTitle>
        <AlertDescription>Dat is niet gelukt.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
  });

  it("renders a Card and a Table", () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Titel</CardTitle>
          </CardHeader>
          <CardContent>Inhoud</CardContent>
        </Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nr.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>#1042</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    );
    expect(screen.getByText("Inhoud")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Nr." })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "#1042" })).toBeInTheDocument();
  });

  it("toggles a Checkbox with the label", () => {
    render(
      <>
        <Checkbox id="c" />
        <Label htmlFor="c">Selecteer</Label>
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "Selecteer" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it("selects one option of a RadioGroup", () => {
    render(
      <RadioGroup defaultValue="inspection" aria-label="Soort werk">
        <RadioGroupItem value="inspection" aria-label="Nazicht" />
        <RadioGroupItem value="repair" aria-label="Herstelling" />
      </RadioGroup>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Herstelling" }));
    expect(screen.getByRole("radio", { name: "Herstelling" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Nazicht" })).not.toBeChecked();
  });

  it("shows the selected value in a Select trigger", () => {
    render(
      <Select defaultValue="b">
        <SelectTrigger aria-label="Technieker">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Kevin</SelectItem>
          <SelectItem value="b">Jens</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Technieker" })).toHaveTextContent("Jens");
  });

  it("switches Tabs", () => {
    render(
      <Tabs defaultValue="todo">
        <TabsList>
          <TabsTrigger value="todo">Te doen</TabsTrigger>
          <TabsTrigger value="done">Afgewerkt</TabsTrigger>
        </TabsList>
        <TabsContent value="todo">Lijst te doen</TabsContent>
        <TabsContent value="done">Lijst afgewerkt</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("Lijst te doen")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Afgewerkt" }));
    expect(screen.getByText("Lijst afgewerkt")).toBeInTheDocument();
  });

  it("opens a Dialog and closes it with the Dutch close button", () => {
    render(
      <Dialog>
        <DialogTrigger>Open dialoog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Taak annuleren</DialogTitle>
          <DialogDescription>Weet je het zeker?</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open dialoog"));
    expect(screen.getByRole("dialog", { name: "Taak annuleren" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sluiten" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
