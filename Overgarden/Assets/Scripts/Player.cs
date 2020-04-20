using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Player : MonoBehaviour
{
    public float maxStamina = 100f;
    public float currentStamina;
    public StaminaBar staminaBar;
    Vector2 direction;
    private float speed;
    public float runSpeed;
    public float normalSpeed;
    private float regen;
    public float walkRegen;
    public float idleRegen;
    public Text pressE;
    
    public Transform player;
    public GameObject onHand;
    public Rigidbody2D rigidbody;
    public Animator animator;
    public GameObject spawnedSeedOther;
    public GameObject spawnedWaterOther; 
    public GameObject spawnedToolOther;

    //public bool pickCondition;
    
    public bool IsMoving
    {
        get
        {
            return direction.x != 0 || direction.y !=0;
        }
    }

    public bool pickWater = false;
    public bool pickSeed = false;
    public bool pickTool = false;
    public bool pickSpawnedSeed = false;
    
    // Start is called before the first frame update
    void Start()
    {
        currentStamina = maxStamina;
        staminaBar.SetMaxStamina(maxStamina);
        rigidbody = GetComponent<Rigidbody2D>();
        animator = GetComponent<Animator>();
    }

    // Update is called once per frame
    void Update()
    {
        rigidbody.velocity = direction.normalized * speed;
        GetInput();

        if (IsMoving)
        {
            ActivateLayer("Walk Layer");
            animator.SetFloat("x", direction.x);
            animator.SetFloat("y", direction.y);
            regen = walkRegen;    
        }
        else if (Input.GetKey(KeyCode.E))
        {
            ActivateLayer("Hold Layer");
        }
        else
        {
            ActivateLayer("Idle Layer");
            regen = idleRegen;
        }


        if (currentStamina > maxStamina)
        {
            currentStamina = maxStamina;
        }
        if (currentStamina < 0)
        {
            currentStamina = 0;
        }

        PickUp();

        teste();
    }

     
    public void GetInput()
    {
        direction = Vector2.zero;

        if (Input.GetKey(KeyCode.W))
        {
            direction += Vector2.up;
        }
        if (Input.GetKey(KeyCode.S))
        {
            direction += Vector2.down;
        }
        if (Input.GetKey(KeyCode.A))
        {
            direction += Vector2.left;
        }
        if (Input.GetKey(KeyCode.D))
        {
            direction += Vector2.right;
        }



        if (Input.GetKey(KeyCode.LeftShift) && IsMoving)
        {
            speed = runSpeed;
            currentStamina -= 0.8f;
            staminaBar.SetStamina(currentStamina);

            if (currentStamina <= 0)
            {
                speed = normalSpeed;
            }
        }
        else
        {
            speed = normalSpeed;
            currentStamina += regen * Time.deltaTime;
            staminaBar.SetStamina(currentStamina);
        }
    }

    //Função que muda layer de animação
    public void ActivateLayer(string layerName)
    {
        for(int i=0; i < animator.layerCount; i++)
        {
            animator.SetLayerWeight(i, 0);
        }

        animator.SetLayerWeight(animator.GetLayerIndex(layerName),1);
    }

    //Colisão
    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Water")
       {
           pickWater = true;
       }

       if (other.tag == "Seed")
       {
           pickSeed = true;
       }

       if (other.tag == "Tool")
       {
           pickTool = true;
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Water")
       {
           pickWater = false;
       }

       if (other.tag == "Seed")
       {
           pickSeed = false;
       }

       if (other.tag == "Tool")
       {
           pickTool = false;
       }
    }

    //Interação com itens do cenário
    private void PickUp()
    {
        if (pickSeed == true)
        {

            if (Input.GetKeyDown(KeyCode.E))
            {
                if (spawnedSeedOther != null)
                {
                    Destroy(spawnedSeedOther);
                    GetComponent<EventsManager>().holdingItem = HoldingItem.NOTHING;
                } 
            }
            
        }
        if (pickWater == true)
        {
            if (Input.GetKeyDown(KeyCode.E))
            {
                GameObject[] waters = GameObject.FindGameObjectsWithTag("Water");
                foreach (GameObject Water in waters)
                {
                    GameObject.Destroy(Water);
                } 
                GetComponent<EventsManager>().holdingItem = HoldingItem.NOTHING;
                
            }
        }
        if (pickTool == true)
        {
            
            if (Input.GetKeyDown(KeyCode.E))
            {
                GameObject[] tools = GameObject.FindGameObjectsWithTag("Tool");
                foreach (GameObject Tool in tools)
                {
                    GameObject.Destroy(Tool);
                }
                GetComponent<EventsManager>().holdingItem = HoldingItem.NOTHING;
            }
        }
        else
        {
            pressE.enabled = false;
        } 
    }

    //Receber item de outro script
    public void seedStallButton()
    {
        spawnedSeedOther = GameObject.FindGameObjectWithTag("Seed");
        GetComponent<EventsManager>().holdingItem = HoldingItem.SEED;
    }

    public bool isWalking()
    {
        if(gameObject.GetComponent<Rigidbody2D>().velocity.magnitude != 0)
        {
            return true;
        }
        else return false;
    }
    public void teste()
    {   
        if(isWalking() == false)
        {
          if(Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.A)
          || Input.GetKeyDown(KeyCode.S) || Input.GetKeyDown(KeyCode.D))
          {
                FindObjectOfType<AudioManager>().Play("Walking Sound");
          }
        }
        else 
        {
            if(Input.GetKeyUp(KeyCode.W) || Input.GetKeyUp(KeyCode.A)
            || Input.GetKeyUp(KeyCode.S) || Input.GetKeyUp(KeyCode.D))
            {
                FindObjectOfType<AudioManager>().Stop("Walking Sound");
            }
        }   
    } 
    public void waterTrigger()
    {
        spawnedWaterOther = GameObject.FindGameObjectWithTag("Water");
        GetComponent<EventsManager>().holdingItem = HoldingItem.WATER;
    }

    public void toolTrigger()
    {
        spawnedToolOther = GameObject.FindGameObjectWithTag("Tool");
        GetComponent<EventsManager>().holdingItem = HoldingItem.TOOL;
    }

    


   

}
