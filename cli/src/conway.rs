use crate::{from_javascript::sleep, wasmio::WasmIO};
use js_sys::Date;
use core::num;
use std::mem;

static mut PSEUDO_RANDOM_BUFFER: u32 = 0;
fn pseudo_random(num: u32) -> bool {
  let result = unsafe {
    PSEUDO_RANDOM_BUFFER ^= num;
    PSEUDO_RANDOM_BUFFER = PSEUDO_RANDOM_BUFFER << 31 | PSEUDO_RANDOM_BUFFER >> 1;
    PSEUDO_RANDOM_BUFFER & 0x0001  == 1
  };
  return result
}

fn seed_random() {
  let seed = unsafe {
    mem::transmute(Date::now() as f32)
  };
  pseudo_random(seed);
}

struct Game {
  board: Vec<Vec<bool>>,
  buffer: Vec<Vec<bool>>,
}

impl Game {
  fn new(width: u32, height: u32) -> Self {
    let mut game = Game {
      board: Vec::new(),
      buffer: Vec::new(),
    };

    game.resize(width, height);

    game
  }

  fn resize(&mut self, width: u32, height: u32) {
    while height > self.board.len() as u32 {
      self.board.push(Vec::new());
    }

    while height < self.board.len() as u32 {
      self.board.pop();
    }

    for row in self.board.iter_mut() {
      while row.len() as u32 > width {
        row.pop();
      }

      while (row.len() as u32) < width {
        let val = pseudo_random(row.len() as u32 & width & height);
        row.push(val);
      }
    }
    self.recreate_buffer()
  }

  fn recreate_buffer(&mut self) {
    self.buffer = self.board.clone();
  }

  fn swap(&mut self) {
    mem::swap(&mut self.board, &mut self.buffer);
  }

  fn display(&self) -> String {
    let mut disp = String::new();
    for row in self.board.iter() {
      for &cell in row.iter() {
        let ch = if cell {'X'} else {' '};
        disp.push(ch);
      }
      disp.push('\n');
      disp.push('\r');
    }
    disp
  }

  fn idx(&self, x: u32, y: u32) -> bool {
    let x = x % self.board.len() as u32;
    let row = self.board.get(x as usize).unwrap();
    let y = y % row.len() as u32;
    row[y as usize]
  }

  fn calc(&mut self, x: u32, y: u32)  {
    let x = x as i32;
    let y = y as i32;
    let mut num_around = 0;
    for dx in [-1, 0, 1i32] {
      for dy in [-1, 0, 1i32] {
        if self.idx((x + dx) as u32, (y + dy) as u32) {
          num_around += 1;
        }
      }
    }

    self.buffer[x as usize][y as usize] = if num_around >= 5 {
      false
    } else if num_around == 3 {
      self.idx(x as u32, y as u32)
    } else if num_around == 2 {
      true
    } else {
      false
    };
  }

  fn step(&mut self) {
    for x in 0 .. self.board.len() as u32 {
      for y in 0 .. self.board[x as usize].len() as u32 {
        self.calc(x, y);
      }
    }
    self.swap();
  }
}


pub async fn conway<'a>(io: &mut WasmIO<'a>) {
  // TODO get size of terminal
  let mut game = Game::new(30, 30);
  seed_random();

  while !io.has_input() {
    io.print(&game.display());
    sleep(300).await;
    game.step()
  }

}
